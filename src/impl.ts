import { DfiCli, ethers } from "./cli.ts";

import {
  Address,
  BlockHeight,
  dst20TokenIdToAddress,
  TokenAmount,
} from "./common.ts";
import { EnvOpts } from "./opts.ts";
import {
  AccountToUtxosArgs,
  AddressMapKind,
  PoolSwapArgs,
  TransferDomainArgs,
  TransferDomainType,
} from "./req.ts";
import { GetAccountIndexedResponse, TokenResponseFormat } from "./resp.ts";
import dst20Abi from "./data/DST20.abi.json" with { type: "json" };
import lockBotAbi from "./data/DUSDBonds.abi.json" with { type: "json" };
import { Amount } from "./common.ts";

class ChainStepCancellationToken {
  private _isCancelled = false;
  isCancelled() {
    return this._isCancelled;
  }
  cancel() {
    this._isCancelled = true;
  }
}

type ChainStepFunc = (cancelToken: ChainStepCancellationToken) => Promise<void>;

// This is used to chain many steps together. Primarily so that
// we can keep track of prev state on execution and print out prev
// and next states so it's helpful when a failure happens but
// don't add noise otherwise.
//
// Passes a cancellation token along to be able to cancel.
export class ChainSteps {
  private funcs: ChainStepFunc[] = [];
  constructor(public ctx: Awaited<ReturnType<typeof createContext>>) {}

  add(func: ChainStepFunc) {
    this.funcs.push(func);
  }

  async run() {
    let lastCtxData = "";
    const cancelToken = new ChainStepCancellationToken();
    console.log("sequence chain start");
    let i = 0;
    for (const func of this.funcs) {
      try {
        if (i++ == 0) console.dir(this.ctx);
        lastCtxData = JSON.stringify(
          this.ctx,
          (_, v) => typeof v === "bigint" ? v.toString() : v,
        );
        await func(cancelToken);
        if (cancelToken.isCancelled()) {
          console.log("sequence chain cancelled");
          return;
        }
      } catch (e) {
        console.log("sequence chain failure");
        console.log("previous-ctx");
        console.dir(JSON.parse(lastCtxData));
        console.log("current-ctx");
        console.dir(this.ctx);
        throw e;
      }
    }
    console.dir(this.ctx);
    console.log("sequence chain completed");
  }
}

export async function createContext(
  cli: DfiCli,
  envOpts: EnvOpts,
  height: BlockHeight,
  diffBlocks: number,
) {
  const { maxDUSDPerBlock } = envOpts;

  const emissionsAddr = new Address(envOpts.emissionsAddr);
  const emissionsAddrStrErc55 =
    (await cli.addressMap(emissionsAddr, AddressMapKind.DvmToErc55))
      .format["erc55"];
  const dUsdToken = await cli.getToken("DUSD");

  const evmDusdTokenDst20Addr = dst20TokenIdToAddress(dUsdToken.id);
  const evmDusdContract = new ethers.Contract(
    evmDusdTokenDst20Addr.value,
    dst20Abi,
    cli.evm()!,
  );

  // Populate init data
  // We get initial balances as close together as possible.
  const balanceInitDfi = await cli.getBalance();
  const balanceTokensInit = await cli.getAccount(
    emissionsAddr,
    TokenResponseFormat.IndexedAsTokenName,
  ) as GetAccountIndexedResponse;
  const poolPairInfoDusdDfi = await cli.getPoolPair("DUSD-DFI");
  const balanceEvmInitDfi = await cli.evm()!.getBalance(emissionsAddrStrErc55);
  const balanceEvmInitDusd: bigint = await evmDusdContract.balanceOf(
    emissionsAddrStrErc55,
  );
  // End init data

  const balanceTokensInitDfi = balanceTokensInit["DFI"] || 0;
  const balanceTokensInitDusd = balanceTokensInit["DUSD"] || 0;

  const dfiPriceForDusd = poolPairInfoDusdDfi["reserveB/reserveA"];
  const dfiForDusdCappedPerBlock = dfiPriceForDusd * maxDUSDPerBlock;
  const dfiToSwapPerBlock = Math.min(
    balanceTokensInitDfi,
    dfiForDusdCappedPerBlock,
  );
  const dfiToSwapForDiffBlocks = dfiToSwapPerBlock * diffBlocks;

  return {
    initHeight: height,
    diffBlocks,
    emissionsAddr,
    emissionsAddrErc55: new Address(emissionsAddrStrErc55),
    evmAddr1: new Address(envOpts.evmAddr1),
    evmAddr2: new Address(envOpts.evmAddr2),
    envOpts,
    balanceInitDfi,
    balanceEvmInitDfi,
    balanceEvmInitDusd,
    balanceTokensInit,
    balanceTokensInitDfi,
    balanceTokensInitDusd,
    poolPairInfoDusdDfi,
    dfiPriceForDusd,
    dfiForDusdCappedPerBlock,
    dfiToSwapPerBlock,
    dfiToSwapForDiffBlocks,
    // We wrap this as fn, as it fails to be printed
    getEvmDusdContract() {
      return evmDusdContract;
    },
    state: {
      currentHeight: height,
      feeReserves: {
        balanceDfi: null as number | null,
      },
      swapDfiToDusd: {
        swapHeight: null as BlockHeight | null,
      },
      postSwapCalc: {
        balanceTokens: null as GetAccountIndexedResponse | null,
        balanceTokenDfi: null as number | null,
        balanceTokenDusd: null as number | null,
        dUsdToTransfer: null as number | null,
      },
    },
  };
}

export async function ensureFeeReserves(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  // Refill utxo from tokens if needed before we start anything
  // Needed for fees in DVM
  const {
    envOpts: { feeReserveAmount },
    state,
    balanceInitDfi,
    emissionsAddr,
  } = ctx;
  const ss = state.feeReserves;

  if (balanceInitDfi < feeReserveAmount) {
    console.log(`refill utxo from account for: ${feeReserveAmount}`);
    const tx = await cli.accountToUtxos(
      new AccountToUtxosArgs(emissionsAddr, emissionsAddr, feeReserveAmount),
    );
    await cli.waitForTx(tx);

    state.currentHeight = await cli.getBlockHeight();
    ss.balanceDfi = await cli.getBalance();
  }

  // Refill EVM DFI from tokens if needed before we start anything
  // Needed for fees in EVM
  const { balanceEvmInitDfi, emissionsAddrErc55 } = ctx;
  if (balanceEvmInitDfi < feeReserveAmount) {
    const nonce = await cli.evm()!.getTransactionCount(
      emissionsAddrErc55.value,
    );
    console.log(
      `refill EVM DFI from account for: ${feeReserveAmount} with transferdomain (nonce: ${nonce})`,
    );
    const tx = await cli.transferDomain(
      new TransferDomainArgs(
        TokenAmount.from(feeReserveAmount, "DFI"),
        emissionsAddr,
        emissionsAddrErc55,
        TransferDomainType.Dvm,
        TransferDomainType.Evm,
        nonce,
      ),
    );
    await cli.waitForTx(tx);

    state.currentHeight = await cli.getBlockHeight();
    ss.balanceDfi = await cli.getBalance();
  }
}

export function initialSanityChecks(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  const {
    envOpts: { feeReserveAmount },
    balanceInitDfi,
    balanceTokensInitDusd,
    dfiToSwapForDiffBlocks,
    state: { feeReserves: { balanceDfi } },
  } = ctx;
  // Sanity checks

  // If fee reserve balance is null, it never ran it.
  const dfiTokenBalance = (balanceDfi == null ? balanceInitDfi : balanceDfi) ||
    0;
  if (dfiTokenBalance < feeReserveAmount) {
    console.log("DFI token balances too low. skipping");
    return false;
  }

  // We disable this check until we shift to getaccount to allow multi-key
  // nodes to work
  //
  // const dusdTokenBalanceStart = balanceTokensInitDusd;
  // if (dusdTokenBalanceStart > 1000) {
  //   console.log(
  //     `DUSD starting bal (${dusdTokenBalanceStart}) too high. skip for manual verification`,
  //   );
  //   return false;
  // }

  if (dfiToSwapForDiffBlocks <= 0) {
    console.log("no DFI to swap");
    return false;
  }
  return true;
}

export async function swapDfiToDusd(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  // Refill utxo from tokens if needed before we start anything
  const {
    emissionsAddr,
    dfiToSwapForDiffBlocks,
    state,
  } = ctx;
  const ss = state.swapDfiToDusd;

  console.log(
    `swap: ${dfiToSwapForDiffBlocks} DFI to DUSD // ${state.currentHeight.value}`,
  );

  const tx = await cli.poolSwap(
    new PoolSwapArgs(emissionsAddr, "DFI", "DUSD", dfiToSwapForDiffBlocks),
  );

  ss.swapHeight = await cli.waitForTx(tx);
  state.currentHeight = await cli.getBlockHeight();
}

export async function makePostSwapCalc(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  // Get DUSD balance after swap
  const { emissionsAddr, balanceTokensInitDusd, state } = ctx;
  const ss = state.postSwapCalc;

  const tokenBalancesAfterSwap = await cli.getAccount(
    emissionsAddr,
    TokenResponseFormat.IndexedAsTokenName,
  ) as GetAccountIndexedResponse;

  const dusdTokenBalance = tokenBalancesAfterSwap["DUSD"] || 0;
  const dfiTokenBalance = tokenBalancesAfterSwap["DFI"] || 0;
  const dUsdToTransfer = dusdTokenBalance - balanceTokensInitDusd;

  ss.balanceTokens = tokenBalancesAfterSwap;
  ss.balanceTokenDfi = dfiTokenBalance;
  ss.balanceTokenDusd = dusdTokenBalance;
  ss.dUsdToTransfer = dUsdToTransfer;

  console.log(`DUSD increase on address: ${dUsdToTransfer}`);
}

export async function burnLeftOverDFI(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  const { emissionsAddr, envOpts: { feeReserveAmount } } = ctx;
  const { balanceTokenDfi } = ctx.state.postSwapCalc;

  const dfiBal = balanceTokenDfi || 0;
  // We retain fee reserve amount for each domain, just to be safe.
  let amountToBurn = Math.max(0, dfiBal - (feeReserveAmount * 2));
  // We reduce another. This takes cares of all floating point related errors.
  amountToBurn -= 1;

  if (amountToBurn <= 0) {
    console.log(`burn: skip due to low reserves: ${amountToBurn}`);
  }

  console.log(`burn DFI: ${amountToBurn}`);

  const tx = await cli.burnTokens({
    from: emissionsAddr,
    amounts: TokenAmount.from(amountToBurn, "DFI"),
  });

  await cli.waitForTx(tx);
}

export async function transferDomainDusdToErc55(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  // TransferDomain to EVM of what we swapped to ERC55 address
  const {
    emissionsAddr,
    emissionsAddrErc55,
    state: { postSwapCalc: { dUsdToTransfer } },
    state,
  } = ctx;
  if (!dUsdToTransfer || dUsdToTransfer <= 0) {
    console.log("no DUSD to transfer, aborting");
    return false;
  }

  const nonce = await cli.evm()!.getTransactionCount(emissionsAddrErc55.value);

  console.log(
    `transfer domain: ${dUsdToTransfer} DUSD to EVM (nonce: ${nonce})`,
  );
  const tx = await cli.transferDomain(
    new TransferDomainArgs(
      TokenAmount.from(dUsdToTransfer, "DUSD"),
      emissionsAddr,
      emissionsAddrErc55,
      TransferDomainType.Dvm,
      TransferDomainType.Evm,
      nonce,
    ),
  );

  state.currentHeight = await cli.waitForTx(tx);
  return true;
}

export async function distributeDusdToContracts(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  const { evmAddr1, evmAddr2, evmAddr1Share } = ctx.envOpts;
  const { dUsdToTransfer } = ctx.state.postSwapCalc;

  if (!dUsdToTransfer || dUsdToTransfer <= 0) {
    // TODO(later): Change the checks to instead extract from EVM land.
    console.log("no DUSD to transfer, aborting");
    return false;
  }

  const { balanceEvmInitDusd, emissionsAddrErc55, getEvmDusdContract } = ctx;
  const evmDusdContract = getEvmDusdContract();
  const balanceEvmDusd: bigint = await evmDusdContract.balanceOf(
    emissionsAddrErc55.value,
  );

  const evmDusdDiff = balanceEvmDusd - balanceEvmInitDusd;
  // We normalize this to sats to ensure that this is a safe comparison.
  // Due to the nature of floats, the last sat can still fall in either place
  // so, we ignore 1 sat diff.
  if (
    evmDusdDiff / BigInt(1e10) -
        Amount.fromUnit(dUsdToTransfer).satsAsBigInt() > 1
  ) {
    console.log(
      "DUSD mismatch between transfer and init balance; manual verification required",
    );
    console.log(
      `dUsdTransferred: ${dUsdToTransfer}; Diff in Contract: ${evmDusdDiff}`,
    );
  }

  // TODO(later): We don't need to just move the diff. Since this is the only
  // bot that does the move, we can just move the entire balance.
  //
  // This way we don't care if we swapped or not, or precision loss.
  // We just move everything that's there as DUSD DST20 to the contracts.
  // But taking a safer approach first to ensure everything works well for testing.

  // Build EVMTx for distributing to EVM contract addresses
  // We don't actually use the evmAddr2Share for now, since this helps us
  // redirect rounding errors to share 2.

  // TODO: Use evmDusdDiff for higher precision.
  const v = dUsdToTransfer;

  const evmAddr1Amount = v * evmAddr1Share;
  const evmAddr2Amount = v - evmAddr1Amount;

  const evmAddr1AmountInWei = Amount.fromUnit(evmAddr1Amount).weiAsBigInt();
  const evmAddr2AmountInWei = Amount.fromUnit(evmAddr2Amount).weiAsBigInt();

  console.log(`evmAddr1Amount: ${evmAddr1Amount} // ${evmAddr1AmountInWei}`);
  console.log(`evmAddr2Amount: ${evmAddr2Amount} // ${evmAddr2AmountInWei}`);

  // Move DUSD DST20 to the smart contracts

  // https://github.com/kuegi/dusd-lock-bot/blob/main/bot/DUSDLockRewards.ts
  // Seems to have it's own addRewards method.

  const evm = cli.evm()!;
  const signer = await evm.getSigner(emissionsAddrErc55.value);

  const lockBotContract1y = new ethers.Contract(
    evmAddr1,
    lockBotAbi,
    signer,
  );
  const lockBotContract2y = new ethers.Contract(
    evmAddr2,
    lockBotAbi,
    signer,
  );

  const cxDusd = evmDusdContract.connect(signer) as ethers.Contract;
  const cxLocks1y = lockBotContract1y.connect(signer) as ethers.Contract;
  const cxLocks2y = lockBotContract2y.connect(signer) as ethers.Contract;

  console.log(
    `approve DUSD to contract 1: ${evmAddr1}: ${evmAddr1AmountInWei}`,
  );
  await cxDusd.approve(evmAddr1, evmAddr1AmountInWei);

  console.log(
    `transfer DUSD to contract 1: ${evmAddr1}: ${evmAddr1AmountInWei}`,
  );
  await cxLocks1y.addRewards(evmAddr1AmountInWei);

  console.log(
    `approve DUSD to contract 2: ${evmAddr2}: ${evmAddr2AmountInWei}`,
  );
  await cxDusd.approve(evmAddr2, evmAddr2AmountInWei);

  console.log(
    `transfer DUSD to contract 2: ${evmAddr2}: ${evmAddr2AmountInWei}`,
  );
  await cxLocks2y.addRewards(evmAddr2AmountInWei);

  return true;
}
