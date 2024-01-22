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
  // await reset(cli, envOpts);
  await bespoke(cli, envOpts);
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
  //   const tx = await cli.transferDomain(
  //     new TransferDomainArgs(
  //       TokenAmount.from(150, "DUSD"),
  //       emissionsAddrErc55,
  //       emissionsAddr,
  //       TransferDomainType.Evm,
  //       TransferDomainType.Dvm,
  //     ),
  //   );
  //   await cli.waitForTx(tx);
  //   const dusdbal = ctx.balanceTokensInitDusd;
  //   const tx2 = await cli.poolSwap(
  //     new PoolSwapArgs(
  //       emissionsAddr,
  //       "DUSD",
  //       "DFI",
  //       dusdbal,
  //     ),
  //   );
  //   await cli.waitForTx(tx2);

  const t = await cli.sendUtxosFrom(emissionsAddr, emissionsAddr, 10);
  await cli.waitForTx(t);
  Deno.exit(0);
}

async function bespoke(cli: DfiCli, envOpts: EnvOpts) {
  const h = await cli.getBlockHeight();
  const ctx = await createContext(cli, envOpts, h, 0);

  const { evmAddr1, evmAddr2, evmAddr1Share } = envOpts;
  const { emissionsAddr, emissionsAddrErc55, getEvmDusdContract } = ctx;

  const v = BigInt(Amount.fromUnit(5).wei().toFixed(0));
  const evmAddr1Amount = v *
    BigInt(Amount.fromUnit(evmAddr1Share).wei().toFixed(0));
  const evmAddr2Amount = v - evmAddr1Amount;

  // Move DUSD DST20 to the smart contracts

  const evm = cli.evm()!;
  const signer = await evm.getSigner(emissionsAddrErc55.value);
  const dUsdToken = await cli.getToken("DUSD");

  const evmDusdTokenDst20Addr = dst20TokenIdToAddress(dUsdToken.id);
  const evmDusdContract = new ethers.Contract(
    evmDusdTokenDst20Addr.value,
    dst20Abi,
    signer,
  );

  console.log(`transfer DUSD to contract 1: ${evmAddr1}: ${evmAddr1Amount}`);
  await evmDusdContract.transfer(evmAddr1, evmAddr1Amount);
  console.log(`transfer DUSD to contract 2: ${evmAddr2}: ${evmAddr2Amount}`);
  await evmDusdContract.transfer(evmAddr2, evmAddr2Amount);
  console.log("transfer domain of dusd completed");
}
