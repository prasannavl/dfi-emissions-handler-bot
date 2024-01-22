#!/usr/bin/env -S deno run --unstable-kv -A
/// <reference lib="deno.unstable" />

import { DfiCli, ethers } from "./cli.ts";
import {
  Address,
  Amount,
  BlockHeight,
  dst20TokenIdToAddress,
  TokenAmount,
} from "./common.ts";
import { EnvOpts, loadEnvOptions } from "./opts.ts";
import {
  createContext,
  distributeDusdToContracts,
  ensureFeeReserves,
  initialSanityChecks,
  makePostSwapCalc,
  swapDfiToDusd,
  transferDomainDusdToErc55,
} from "./impl.ts";

async function main() {
  const cli = new DfiCli(null, "-testnet");
  console.log(`cli: ${cli.path} ${cli.args.join(" ")}`);

  const kv = await Deno.openKv(".state");

  let lastRunBlock = (await kv.get<number>(["lastRunBlock"]))?.value ?? 0;
  console.log(`lastRunBlock: ${lastRunBlock}`);

  const envOpts = await loadEnvOptions();
  console.log(envOpts);

  const { runIntervalMod, startBlock, endBlock, evmJsonRpc } = envOpts;
  cli.setEvmProvider(new ethers.JsonRpcProvider(evmJsonRpc));

  cli.addEachBlockEvent(async (height) => {
    const forceStart = resolveForceStart(envOpts);

    if (height.value > startBlock && height.value < endBlock) {
      console.log("height", height);

      const updateState = async () => {
        lastRunBlock = height.value;
        await kv.set(["lastRunBlock"], lastRunBlock);
      };

      const diffBlocks = height.value - (Math.max(lastRunBlock, startBlock));

      // ===== Start: Test items ======
      await runEmissionSequence(cli, envOpts, height, diffBlocks);
      // ====== End: Test items ========

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

async function runEmissionSequence(
  cli: DfiCli,
  envOpts: EnvOpts,
  height: BlockHeight,
  diffBlocks: number,
) {
  console.log(`runSequence: ${height.value} ${diffBlocks}`);
  const ctx = await createContext(cli, envOpts, height, diffBlocks);
  let lastContextData = "";
  const updateDebugContext = () => {
    lastContextData = JSON.stringify(
      ctx,
      (_, v) => typeof v === "bigint" ? v.toString() : v,
    );
  };
  updateDebugContext();
  console.dir(ctx);

  try {
    await ensureFeeReserves(cli, ctx);
    updateDebugContext();
    if (!initialSanityChecks(cli, ctx)) {
      throw new Error("sanity checks failed");
    }
    updateDebugContext();
    await swapDfiToDusd(cli, ctx);
    updateDebugContext();
    await makePostSwapCalc(cli, ctx);
    updateDebugContext();
    // TODO: Add burn in the end to burn rest.
    if (!(await transferDomainDusdToErc55(cli, ctx))) {
      throw new Error("failed on transfer domain phase");
    }
    updateDebugContext();
    if (!await distributeDusdToContracts(cli, ctx)) {
      throw new Error("failed on distribute DUSD phase");
    }
    console.log(ctx);
    console.log("completed Sequence");
  } catch (e) {
    console.log("sequence failure.");
    console.log("previous-ctx");
    console.dir(lastContextData);
    console.log("current-ctx");
    console.dir(ctx);
    throw e;
  }
}

main();
