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

import {
  AccountToAccountArgs,
  AccountToUtxosArgs,
  PoolSwapArgs,
} from "./req.ts";
import { TransferDomainArgs, TransferDomainType } from "./req.ts";
import { GetTokenBalancesResponseDecoded } from "./resp.ts";
import dst20Abi from "./data/dst20.abi.json" with { type: "json" };

export async function test(cli: DfiCli, envOpts: EnvOpts) {
  // await seed(cli, envOpts);
  await reset(cli, envOpts);
  // await bespoke(cli, envOpts);
  Deno.exit(0);
}

async function seed(cli: DfiCli, envOpts: EnvOpts) {
  const { emissionsAddr } = envOpts;
  const tx = await cli.accountToUtxos(
    new AccountToUtxosArgs(
      new Address(emissionsAddr),
      new Address("tf1q3l5xjrncn48fnqsxckssndu3jlpzfj88tueutf"),
      5,
    ),
  );
  await cli.waitForTx(tx);

  const tx2 = await cli.accountToAccount(
    new AccountToAccountArgs(
      new Address(emissionsAddr),
      new Address("tf1q3l5xjrncn48fnqsxckssndu3jlpzfj88tueutf"),
      TokenAmount.from(1000, "DFI"),
    ),
  );
  await cli.waitForTx(tx2);
}

async function reset(cli: DfiCli, envOpts: EnvOpts) {
  const h = await cli.getBlockHeight();
  const ctx = await createContext(cli, envOpts, h, 0);
  const { emissionsAddr, emissionsAddrErc55 } = ctx;
    // const tx = await cli.transferDomain(
    //   new TransferDomainArgs(
    //     TokenAmount.from(150, "DUSD"),
    //     emissionsAddrErc55,
    //     emissionsAddr,
    //     TransferDomainType.Evm,
    //     TransferDomainType.Dvm,
    //   ),
    // );
    // await cli.waitForTx(tx);
    const dusdbal = ctx.balanceTokensInitDusd;
    const tx2 = await cli.poolSwap(
      new PoolSwapArgs(
        emissionsAddr,
        "DUSD",
        "DFI",
        dusdbal,
      ),
    );
    await cli.waitForTx(tx2);

  // const t = await cli.sendUtxosFrom(emissionsAddr, emissionsAddr, 10);
  // await cli.waitForTx(t);
  Deno.exit(0);
}

async function bespoke(cli: DfiCli, envOpts: EnvOpts) {
  const h = await cli.getBlockHeight();
  const ctx = await createContext(cli, envOpts, h, 0);

  const { evmAddr1, evmAddr2, evmAddr1Share } = envOpts;

  const { balanceEvmInitDusd, emissionsAddrErc55, getEvmDusdContract } = ctx;
  const evmDusdContract = getEvmDusdContract();
  const balanceEvmDusd: bigint = await evmDusdContract.balanceOf(
    emissionsAddrErc55.value,
  );

  const dUsdToTransfer = 5;

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
  // Seems to have it's own addRewards method. Will need to add to that instead
  // of a simple transfer.

  const evm = cli.evm()!;
  const signer = await evm.getSigner(emissionsAddrErc55.value);
  const cx = evmDusdContract.connect(signer) as ethers.Contract;

  console.log(
    `transfer DUSD to contract 1: ${evmAddr1}: ${evmAddr1AmountInWei}`,
  );
  await cx.transfer(evmAddr1, BigInt(evmAddr1AmountInWei));
  console.log(
    `transfer DUSD to contract 2: ${evmAddr2}: ${evmAddr2AmountInWei}`,
  );
  await cx.transfer(evmAddr2, BigInt(evmAddr2AmountInWei));
  console.log("transfer domain of dusd completed");
}
