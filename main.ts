#!/usr/bin/env -S deno run --unstable-kv -A

/// <reference lib="deno.unstable" />

import { DfiCli } from "./cli.ts";
import { BlockHeight, Address } from "./types/base.ts";
import { AccountToUtxosArgs } from "./types/req.ts";

async function main() {
  const cli = new DfiCli(null, "-testnet");
  console.log(`DEFI_CLI: ${cli.path} ${cli.args.join(" ")}`);
  const runIntervalMod = 2;
  const startBlock = 1300000;
  const endBlock = Number.MAX_VALUE;

  const kv = await Deno.openKv(".state");

  let lastRunBlock = (await kv.get<number>(["lastRunBlock"]))?.value ?? 0;
  console.log(`lastRunBlock: ${lastRunBlock}`);

  cli.addEachBlockEvent(async (height) => {
    if (height.value > startBlock && height.value < endBlock) {
      console.log('height', height);

      const updateState = async () => {
        lastRunBlock = height.value;
        await kv.set(["lastRunBlock"], lastRunBlock);
      };

      const diffBlocks = (height.value - (Math.max(lastRunBlock, startBlock)));
      if (diffBlocks > runIntervalMod || height.value % runIntervalMod === 0) {
        // Run if we've either skipped in-between or during the mod period 
        runSequence(cli, height, diffBlocks);
        await updateState();
      }
    }
  });

  await cli.runBlockEventLoop();
}


async function runSequence(cli: DfiCli, height: BlockHeight, diffBlocks: number) {
  console.log(`runSequence: ${height.value} ${diffBlocks}`);
  const emissionsAddr = new Address("tDFiEYXpRt5xKtRJzP2CDPQJwXkX3XoJz3");
  const maxDUSDCapPerBlock = 20;
  const reservedUtxoForFees = 10;
  let currentHeight = height;

  // Refill utxo if needed
  const balance = await cli.getBalance();
  if (balance < reservedUtxoForFees) {
    console.log(`Refilling balance: current: ${balance}`);
    const tx = await cli.accountToUtxos(new AccountToUtxosArgs(emissionsAddr, emissionsAddr, reservedUtxoForFees));
    await cli.waitForTx(tx);
  }
}

main();
