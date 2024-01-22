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
  ChainSteps,
  createContext,
  distributeDusdToContracts,
  ensureFeeReserves,
  initialSanityChecks,
  makePostSwapCalc,
  swapDfiToDusd,
  transferDomainDusdToErc55,
} from "./impl.ts";

import { test } from "./test.ts";
import { patchConsoleLogWithTime } from "./common.ts";

async function main() {
  patchConsoleLogWithTime();
  const cli = new DfiCli(null, "-testnet");
  console.log(`cli: ${cli.path} ${cli.args.join(" ")}`);

  const kv = await Deno.openKv(".state");

  let lastRunBlock = (await kv.get<number>(["lastRunBlock"]))?.value ?? 0;
  console.log(`lastRunBlock: ${lastRunBlock}`);

  const envOpts = await loadEnvOptions();
  console.log(envOpts);

  const { runIntervalMod, startBlock, endBlock, evmJsonRpc } = envOpts;
  cli.setEvmProvider(new ethers.JsonRpcProvider(evmJsonRpc));

  // Test method to intercept and exit
  // Uncomment to test small units
  // await test(cli, envOpts);

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
      await runEmissionSequence(cli, envOpts, height, 1);      
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
  const chain = new ChainSteps(ctx);

  chain.add(async () => {
    await ensureFeeReserves(cli, ctx);
    if (!initialSanityChecks(cli, ctx)) {
      throw new Error("sanity checks failed");
    }
  });

  chain.add(async () => {
    await swapDfiToDusd(cli, ctx);
  });

  chain.add(async () => {
    await makePostSwapCalc(cli, ctx);
  });

  // TODO: Add burn in the end to burn rest.

  chain.add(async () => {
    if (!(await transferDomainDusdToErc55(cli, ctx))) {
      throw new Error("failed on transfer domain phase");
    }
  });

  chain.add(async () => {
    if (!await distributeDusdToContracts(cli, ctx)) {
      throw new Error("failed on distribute DUSD phase");
    }
  });

  await chain.run();
}

main();
