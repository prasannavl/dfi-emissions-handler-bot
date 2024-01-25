#!/usr/bin/env -S deno run --unstable-kv -A
/// <reference lib="deno.unstable" />

import { DfiCli, ethers } from "./cli.ts";
import { BlockHeight } from "./common.ts";
import { EnvOpts, loadEnvOptions } from "./opts.ts";
import {
  burnLeftOverDFI,
  ChainSteps,
  createContext,
  distributeDusdToContracts,
  ensureFeeReserves,
  initialSanityChecks,
  makePostSwapCalc,
  swapDfiToDusd,
  transferDomainDusdToErc55,
} from "./impl.ts";

import { initTimedLogger } from "./common.ts";

async function main() {
  const envOpts = await loadEnvOptions();
  initTimedLogger();

  console.log(envOpts);

  const cli = new DfiCli();
  console.log(`cli: ${cli.path} ${cli.args.join(" ")}`);

  const kv = await Deno.openKv(".state");

  let lastRunBlock = (await kv.get<number>(["lastRunBlock"]))?.value ?? 0;
  console.log(`lastRunBlock: ${lastRunBlock}`);

  const { runIntervalMod, startBlock, endBlock, evmJsonRpc } = envOpts;

  console.log(`create evm rpc provider for: ${evmJsonRpc}`);
  cli.setEvmProvider(new ethers.JsonRpcProvider(evmJsonRpc));
  console.log(`evm provider set`);

  cli.addEachBlockEvent(async (height) => {
    const forceStart = resolveForceStart(envOpts);

    if (height.value > startBlock && height.value < endBlock) {
      console.log("height", height);

      const markLastUpdated = async () => {
        lastRunBlock = height.value;
        await kv.set(["lastRunBlock"], lastRunBlock);
      };

      const diffBlocks = height.value - (Math.max(lastRunBlock, startBlock));
      // Note that we don't particularly need the mod == 0 check, since the
      // diffBlocks is enough, but we still add it to normalize drifts
      // over a long enough runtime as sequences will span many blocks.
      if (
        forceStart ||
        (diffBlocks > runIntervalMod || height.value % runIntervalMod === 0)
      ) {
        // Run if we've either skipped in-between or during the mod period
        await runEmissionSequence(cli, envOpts, height, diffBlocks);
        await markLastUpdated();
      }
    }
  });

  console.log("running block event loop");
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
    await burnLeftOverDFI(cli, ctx);
  });

  chain.add(async () => {
    const res = await transferDomainDusdToErc55(cli, ctx);
    if (!res) {
      throw new Error("failed on transfer domain phase");
    }
  });

  chain.add(async () => {
    const res = await distributeDusdToContracts(cli, ctx);
    if (!res) {
      throw new Error("failed on distribute DUSD phase");
    }
  });

  await chain.run();
}

main();
