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
import { GetTokenBalancesResponseDecoded } from "./resp.ts";
import dst20Abi from "./data/DST20.abi.json" with { type: "json" };
import lockBotAbi from "./data/DUSDBonds.abi.json" with { type: "json" };
import { Amount } from "./common.ts";

export class ChainSteps {
  private funcs: Array<() => Promise<void>> = [];
  constructor(public ctx: Awaited<ReturnType<typeof createContext>>) {}

  add(func: () => Promise<void>) {
    this.funcs.push(func);
  }

  async run() {
    let lastCtxData = "";
    console.log("sequence chain start");
    let i = 0;
    for (const func of this.funcs) {
      try {
        if (i++ == 0) console.dir(this.ctx);
        lastCtxData = JSON.stringify(
          this.ctx,
          (_, v) => typeof v === "bigint" ? v.toString() : v,
        );
        await func();
      } catch (e) {
        console.log("sequence chain failure");
        console.log("previous-ctx");
        console.log(lastCtxData);
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
  const balanceInit = await cli.getBalance();
  const balanceTokensInit = await cli.getTokenBalances(
    true,
    true,
  ) as GetTokenBalancesResponseDecoded;
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
    balanceInit,
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
      balanceTokensDfi: balanceTokensInitDfi,
      balanceEvmDfi: balanceEvmInitDfi,
      swapDfiToDusd: {
        swapHeight: null as BlockHeight | null,
      },
      postSwapCalc: {
        balanceTokens: null as GetTokenBalancesResponseDecoded | null,
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
  const { envOpts: { feeReserveAmount }, state, balanceInit, emissionsAddr } =
    ctx;

  if (balanceInit < feeReserveAmount) {
    console.log(`refill utxo from account for: ${feeReserveAmount}`);
    const tx = await cli.accountToUtxos(
      new AccountToUtxosArgs(emissionsAddr, emissionsAddr, feeReserveAmount),
    );
    await cli.waitForTx(tx);
    state.balanceTokensDfi -= feeReserveAmount;
    state.currentHeight = await cli.getBlockHeight();
  }

  // Refill EVM DFI from tokens if needed before we start anything
  // Needed for fees in EVM
  const { balanceEvmInitDfi, emissionsAddrErc55 } = ctx;
  if (balanceEvmInitDfi < feeReserveAmount) {
    console.log(`refill EVM DFI from account for: ${feeReserveAmount}`);
    const tx = await cli.transferDomain(
      new TransferDomainArgs(
        TokenAmount.from(feeReserveAmount, "DFI"),
        emissionsAddr,
        emissionsAddrErc55,
        TransferDomainType.Dvm,
        TransferDomainType.Evm,
      ),
    );
    await cli.waitForTx(tx);
    state.balanceTokensDfi -= feeReserveAmount;
    state.balanceEvmDfi = await cli.evm()!.getBalance(emissionsAddrErc55.value);
    state.currentHeight = await cli.getBlockHeight();
  }
}

export function initialSanityChecks(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  const {
    envOpts: { feeReserveAmount },
    balanceTokensInit,
    dfiToSwapForDiffBlocks,
  } = ctx;
  // Sanity checks
  const dfiTokenBalance = balanceTokensInit["DFI"] || 0;
  if (dfiTokenBalance < feeReserveAmount) {
    console.log(`DFI token balances too low. skipping`);
    return false;
  }
  const dusdTokenBalanceStart = balanceTokensInit["DUSD"] || 0;
  if (dusdTokenBalanceStart > 500) {
    console.log(
      `DUSD starting balance too high. skipping for manual verification`,
    );
    return false;
  }

  if (dfiToSwapForDiffBlocks <= 0) {
    console.log(`no DFI to swap`);
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

  console.log("swap completed");
}

export async function makePostSwapCalc(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  // Get DUSD balance after swap
  const { balanceTokensInitDusd, state } = ctx;
  const ss = state.postSwapCalc;

  const tokenBalancesAfterSwap = await cli.getTokenBalances(
    true,
    true,
  ) as GetTokenBalancesResponseDecoded;

  const dusdTokenBalance = tokenBalancesAfterSwap["DUSD"] || 0;
  const dUsdToTransfer = dusdTokenBalance - balanceTokensInitDusd;

  ss.balanceTokens = tokenBalancesAfterSwap;
  ss.balanceTokenDusd = dusdTokenBalance;
  ss.dUsdToTransfer = dUsdToTransfer;

  console.log(`DUSD increase on address: ${dUsdToTransfer}`);
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
    console.log("no DUSD to transfer, skipping");
    return false;
  }

  const nonce = await cli.evm()!.getTransactionCount(emissionsAddrErc55.value);

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

  console.log("transfer domain of dusd completed");
  return true;
}

export async function distributeDusdToContracts(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  const { evmAddr1, evmAddr2, evmAddr1Share } = ctx.envOpts;
  const { dUsdToTransfer } = ctx.state.postSwapCalc;

  if (!dUsdToTransfer || dUsdToTransfer <= 0) {
    // TODO(later): Change the checks to be done in EVM land instead and not use postSwapCalc
    // state at all, and instead extract from EVM land.
    console.log("no DUSD to transfer, skipping");
    return false;
  }

  const { balanceEvmInitDusd, emissionsAddrErc55, getEvmDusdContract } = ctx;
  const evmDusdContract = getEvmDusdContract();
  const balanceEvmDusd: bigint = await evmDusdContract.balanceOf(
    emissionsAddrErc55.value,
  );

  const evmDusdDiff = balanceEvmDusd - balanceEvmInitDusd;
  // Note, we're still converting a float. So, can expect this
  // to be off and fail. Just until the rest of the parts
  // are moved off float.
  if (evmDusdDiff != BigInt(Amount.fromUnit(dUsdToTransfer).wei().toFixed(0))) {
    console.log(
      "DUSD mistmatch between transfer and init balance; manual verification required",
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

  const evmAddr1AmountInWei = Amount.fromUnit(evmAddr1Amount).wei().toFixed(0);
  const evmAddr2AmountInWei = Amount.fromUnit(evmAddr2Amount).wei().toFixed(0);

  // Move DUSD DST20 to the smart contracts

  // https://github.com/kuegi/dusd-lock-bot/blob/main/bot/DUSDLockRewards.ts
  // Seems to have it's own addRewards method. 

  const evm = cli.evm()!;
  const signer = await evm.getSigner(emissionsAddrErc55.value);

  const lockBotContract_1Y = new ethers.Contract(
    evmAddr1,
    lockBotAbi,
    signer,
  );
  const lockBotContract_2Y = new ethers.Contract(
    evmAddr2,
    lockBotAbi,
    signer,
  );

  const cx_DUSD = evmDusdContract.connect(signer) as ethers.Contract;
  const cx_1Y = lockBotContract_1Y.connect(signer) as ethers.Contract;
  const cx_2Y = lockBotContract_2Y.connect(signer) as ethers.Contract;
  
  console.log(
    `approving DUSD to contract 1: ${evmAddr1}: ${evmAddr1AmountInWei}`,
  );
  await cx_DUSD.approve(evmAddr1, BigInt(evmAddr1AmountInWei));

  console.log(
    `transfer DUSD to contract 1: ${evmAddr1}: ${evmAddr1AmountInWei}`,
  );
  await cx_1Y.addRewards(BigInt(evmAddr1AmountInWei));

  console.log(
    `approving DUSD to contract 2: ${evmAddr2}: ${evmAddr2AmountInWei}`,
  );
  await cx_DUSD.approve(evmAddr2, BigInt(evmAddr2AmountInWei));

  console.log(
    `transfer DUSD to contract 2: ${evmAddr2}: ${evmAddr2AmountInWei}`,
  );
  await cx_2Y.addRewards(BigInt(evmAddr2AmountInWei));
  console.log("transfer domain of dusd completed");
  
  return true;
}
