#!/usr/bin/env -S deno run --unstable-kv -A
/// <reference lib="deno.unstable" />

import { DfiCli } from "./cli.ts";
import {
  Address,
  BlockHeight,
  dst20TokenIdToAddress,
  TokenAmount,
} from "./common.ts";
import { EnvOpts, loadEnvOptions } from "./opts.ts";
import {
  AccountToUtxosArgs,
  AddressMapKind,
  AddressType,
  PoolSwapArgs,
  TransferDomainArgs,
  TransferDomainType,
} from "./req.ts";
import { GetTokenBalancesResponseDecoded } from "./resp.ts";

async function runEmissionSequence(
  cli: DfiCli,
  envOpts: EnvOpts,
  height: BlockHeight,
  diffBlocks: number,
) {
  console.log(`runSequence: ${height.value} ${diffBlocks}`);
  const ctx = await createContext(cli, envOpts, height, diffBlocks);
  console.log(ctx);

  await ensureUtxoRefilled(cli, ctx);
  if (!initialSanityChecks(cli, ctx)) {
    return;
  }
  await swapDfiToDusd(cli, ctx);
  await makePostSwapCalc(cli, ctx);
  if (!(await transferDomainDusdToErc55(cli, ctx))) {
    return;
  }
  if (!await distributeDusdToContracts(cli, ctx)) {
    return;
  }

  console.log(ctx);
  console.log("completed Sequence");
}

async function main() {
  const cli = new DfiCli(null, "-testnet");
  console.log(`cli: ${cli.path} ${cli.args.join(" ")}`);
  const kv = await Deno.openKv(".state");

  let lastRunBlock = (await kv.get<number>(["lastRunBlock"]))?.value ?? 0;
  console.log(`lastRunBlock: ${lastRunBlock}`);

  const envOpts = await loadEnvOptions();
  console.log(envOpts);
  const { runIntervalMod, startBlock, endBlock } = envOpts;

  cli.addEachBlockEvent(async (height) => {
    const forceStart = resolveForceStart(envOpts);

    if (height.value > startBlock && height.value < endBlock) {
      console.log("height", height);

      const updateState = async () => {
        lastRunBlock = height.value;
        await kv.set(["lastRunBlock"], lastRunBlock);
      };

      // ===== Start: Test items ======
      console.log(
        await cli.ethGetBalance(
          new Address("0x2683f524C6477a3D84c6d1492a1b51e0B4146d36"),
        ),
      );
      const dusdToken = await cli.getToken("DUSD");
      console.log(dusdToken);
      console.log(dst20TokenIdToAddress(dusdToken.id));
      // console.log((await cli.getNewAddress()));
      console.log(await cli.ethChainId());
      console.log(await cli.ethGetBalance(new Address("0x2683f524C6477a3D84c6d1492a1b51e0B4146d36")));
      console.log(await cli.ethGasPrice());
      // ====== End: Test items ========


      const diffBlocks = height.value - (Math.max(lastRunBlock, startBlock));
      if (
        forceStart ||
        (diffBlocks > runIntervalMod || height.value % runIntervalMod === 0)
      ) {
        // Run if we've either skipped in-between or during the mod period
        // runEmissionSequence(cli, envOpts, height, diffBlocks);
        await updateState();
      }
    }
  });

  await cli.runBlockEventLoop();
}

function resolveForceStart(envOpts: EnvOpts) {
  if (envOpts.forceStart === true) {
    envOpts.forceStart = false;
    return true;
  }
  return false;
}

async function createContext(
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

  const balanceInit = await cli.getBalance();
  const balanceTokensInit = await cli.getTokenBalances(
    true,
    true,
  ) as GetTokenBalancesResponseDecoded;
  const poolPairInfoDusdDfi = await cli.getPoolPair("DUSD-DFI");
  const balanceTokensInitDfi = balanceTokensInit["DFI"];
  const balanceTokensInitDusd = balanceTokensInit["DUSD"];

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
    balanceTokensInit,
    balanceTokensInitDfi,
    balanceTokensInitDusd,
    poolPairInfoDusdDfi,
    dfiPriceForDusd,
    dfiForDusdCappedPerBlock,
    dfiToSwapPerBlock,
    dfiToSwapForDiffBlocks,
    state: {
      currentHeight: height,
      balanceTokensDfi: balanceTokensInitDfi,
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

async function ensureUtxoRefilled(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  // Refill utxo from tokens if needed before we start anything
  const { envOpts: { utxoReserve }, state, balanceInit, emissionsAddr } = ctx;

  console.log(`init balance: ${balanceInit}`);
  if (balanceInit < utxoReserve) {
    console.log(`refill utxo from account for: ${utxoReserve}`);
    const tx = await cli.accountToUtxos(
      new AccountToUtxosArgs(emissionsAddr, emissionsAddr, utxoReserve),
    );
    await cli.waitForTx(tx);
    state.currentHeight = await cli.getBlockHeight();
    state.balanceTokensDfi -= utxoReserve;
  }
}

function initialSanityChecks(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  const {
    envOpts: { utxoReserve },
    balanceTokensInit,
    dfiToSwapForDiffBlocks,
  } = ctx;
  // Sanity checks
  const dfiTokenBalance = balanceTokensInit["DFI"];
  if (dfiTokenBalance < utxoReserve) {
    console.log(`DFI token balances too low. skipping`);
    return false;
  }
  const dusdTokenBalanceStart = balanceTokensInit["DUSD"] || 0;
  if (dusdTokenBalanceStart > 100) {
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

async function swapDfiToDusd(
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

async function makePostSwapCalc(
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

  const dusdTokenBalance = tokenBalancesAfterSwap["DUSD"];
  const dUsdToTransfer = dusdTokenBalance - balanceTokensInitDusd;

  ss.balanceTokens = tokenBalancesAfterSwap;
  ss.balanceTokenDusd = dusdTokenBalance;
  ss.dUsdToTransfer = dUsdToTransfer;
}

async function transferDomainDusdToErc55(
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

  const tx = await cli.transferDomain(
    new TransferDomainArgs(
      emissionsAddr,
      TokenAmount.from(dUsdToTransfer, "DUSD"),
      emissionsAddrErc55,
      TransferDomainType.Dvm,
      TransferDomainType.Evm,
    ),
  );

  state.currentHeight = await cli.waitForTx(tx);
  return true;
}

async function distributeDusdToContracts(
  cli: DfiCli,
  ctx: Awaited<ReturnType<typeof createContext>>,
) {
  const { evmAddr1, evmAddr2, evmAddr1Share, evmAddr2Share } = ctx.envOpts;
  const { dUsdToTransfer } = ctx.state.postSwapCalc;

  if (!dUsdToTransfer || dUsdToTransfer <= 0) {
    // TODO(later): Change the checks to be done in EVM land instead and not use postSwapCalc
    // state at all, and instead extract from EVM land.
    console.log("no DUSD to transfer, skipping");
    return false;
  }

  // Build EVMTx for distributing to EVM contract addresses
  // We don't actually use the evmAddr2Share for now, since this helps us
  // redirect rounding errors to share 2.
  const evmAddr1Amount = dUsdToTransfer * evmAddr1Share;
  const evmAddr2Amount = dUsdToTransfer - evmAddr1Amount;

  // Move DUSD DST20 to the smart contracts

  return true;
}

main();
