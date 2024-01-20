#!/usr/bin/env -S deno run --unstable-kv -A
/// <reference lib="deno.unstable" />

import { DfiCli } from "./cli.ts";
import { Address, BlockHeight } from "./common.ts";
import { AccountToUtxosArgs, PoolSwapArgs } from "./req.ts";
import { GetTokenBalancesResponseDecoded } from "./resp.ts";

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
      console.log("height", height);

      const updateState = async () => {
        lastRunBlock = height.value;
        await kv.set(["lastRunBlock"], lastRunBlock);
      };

      await runSequence(cli, height, 10);

      const diffBlocks = height.value - (Math.max(lastRunBlock, startBlock));
      if (diffBlocks > runIntervalMod || height.value % runIntervalMod === 0) {
        // Run if we've either skipped in-between or during the mod period
        runSequence(cli, height, diffBlocks);
        await updateState();
      }
    }
  });

  await cli.runBlockEventLoop();
}

async function runSequence(
  cli: DfiCli,
  height: BlockHeight,
  diffBlocks: number,
) {
  console.log(`runSequence: ${height.value} ${diffBlocks}`);
  const emissionsAddr = new Address("tDFiEYXpRt5xKtRJzP2CDPQJwXkX3XoJz3");
  const maxDUSDSwapsPerBlock = 20;
  const reservedUtxoForFees = 10;
  let currentHeight = height;

  // Refill utxo from tokens if needed before we start anything
  const balanceInit = await cli.getBalance();
  console.log(`initial balance: ${balanceInit}`);
  if (balanceInit < reservedUtxoForFees) {
    console.log(`refill utxo from account for: ${reservedUtxoForFees}`);
    const tx = await cli.accountToUtxos(
      new AccountToUtxosArgs(emissionsAddr, emissionsAddr, reservedUtxoForFees),
    );
    await cli.waitForTx(tx);
    currentHeight = await cli.getBlockHeight();
  }

  // We get all the info in one go to reduce the distance of non-atomic operations.
  const balance = currentHeight.value === height.value
    ? balanceInit
    : await cli.getBalance();
  const tokenBalances = await cli.getTokenBalances(
    true,
    true,
  ) as GetTokenBalancesResponseDecoded;
  const poolPairInfo = await cli.getPoolPair("DUSD-DFI");

  // Sanity checks
  let dfiTokenBalance = tokenBalances["DFI"];
  if (dfiTokenBalance < reservedUtxoForFees) {
    console.log(`DFI token balances too low. skipping`);
    return;
  }
  const dusdTokenBalanceStart = tokenBalances["DUSD"] || 0;
  if (dusdTokenBalanceStart > 100) {
    console.log(
      `DUSD starting balance too high. skipping for manual verification`,
    );
    return;
  }

  // DFI calculations
  const dfiPrice = Object.values(poolPairInfo)[0]["reserveB/reserveA"];
  const cappedDFI = dfiPrice * maxDUSDSwapsPerBlock;

  dfiTokenBalance = tokenBalances["DFI"];
  const dfiToSwapPerBlock = Math.min(dfiTokenBalance, cappedDFI);
  const dfiToSwap = dfiToSwapPerBlock * diffBlocks;

  console.log(
    `balances: UTXO: ${balance}, DFI: ${dfiTokenBalance}, DUSD: ${dusdTokenBalanceStart}`,
  );
  console.log(`prices: DFI / DUSD: ${dfiPrice}, per block cap: ${cappedDFI}`);
  console.log(
    `DFI to swap: per block: ${dfiToSwapPerBlock}, total: ${dfiToSwap}`,
  );

  if (dfiToSwap <= 0) {
    console.log(`no DFI to swap on ${currentHeight.value}`);
    return;
  }

  // Swap DFI for DUSD
  console.log(`swap ${dfiToSwap} DFI for DUSD on ${currentHeight.value}}`);
  const tx = await cli.poolSwap(
    new PoolSwapArgs(emissionsAddr, "DFI", "DUSD", dfiToSwap),
  );
  const swapHeight = await cli.waitForTx(tx);
  currentHeight = await cli.getBlockHeight();

  // TransferDomain to EVM of what we swapped to ERC55 address

  // EVMTx for distributing to EVM contract addresses
}

main();
