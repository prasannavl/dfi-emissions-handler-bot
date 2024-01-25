import { load } from "std/dotenv/mod.ts";

export type EnvOpts = Awaited<ReturnType<typeof loadEnvOptions>>;

export async function loadEnvOptions() {
  class Option<T> {
    constructor(
      public env: string,
      public defaultValue: string,
      public required = false,
      public transformFn: (v: string) => T,
    ) {
    }

    get() {
      const v = Deno.env.get(this.env);
      if (this.required && !v) {
        throw new Error(`env ${this.env} REQUIRED`);
      }
      return this.transformFn(v || this.defaultValue);
    }
  }

  let envPath = ".env";
  const envPathOverride = Deno.env.get("ENV");
  if (envPathOverride && envPathOverride.length > 0) {
    const fileExists = await Deno.stat(envPathOverride).then(() => true).catch(
      () => false,
    );
    envPath = fileExists ? envPathOverride : `.env.${envPathOverride}`;
  }

  await load({ envPath: envPath, export: true });

  const opts = {
    evmJsonRpc: new Option("BOT_EVM_JSON_RPC", "", true, (v) => v),
    emissionsAddr: new Option("BOT_EMISSIONS_ADDRESS", "", true, (v) => v),
    evmAddr1: new Option("BOT_SC_YEAR_1_ADDR", "", true, (v) => v),
    evmAddr1Share: new Option(
      "BOT_SC_YEAR_1_SHARE",
      "",
      true,
      parseFloat,
    ),
    evmAddr2: new Option("BOT_SC_YEAR_2_ADDR", "", true, (v) => v),
    evmAddr2Share: new Option(
      "BOT_SC_YEAR_2_SHARE",
      "",
      true,
      parseFloat,
    ),
    runIntervalMod: new Option("BOT_RUN_INTERVAL_MOD", "", true, parseInt),
    forceStart: new Option(
      "BOT_FORCE_START",
      "false",
      false,
      (v) => v === "true" || v === "1",
    ),
    startBlock: new Option("BOT_START_BLOCK", "", true, parseInt),
    endBlock: new Option(
      "BOT_END_BLOCK",
      "-1",
      false,
      (v) => v === "-1" ? Number.MAX_VALUE : parseInt(v),
    ),
    maxDUSDPerBlock: new Option(
      "BOT_MAX_DUSD_PER_BLOCK",
      "1",
      false,
      parseInt,
    ),
    feeReserveAmount: new Option("BOT_FEE_RESERVE", "10", false, parseInt),
  };

  return {
    evmJsonRpc: opts.evmJsonRpc.get(),
    emissionsAddr: opts.emissionsAddr.get(),
    evmAddr1: opts.evmAddr1.get(),
    evmAddr1Share: opts.evmAddr1Share.get(),
    evmAddr2: opts.evmAddr2.get(),
    evmAddr2Share: opts.evmAddr2Share.get(),
    runIntervalMod: opts.runIntervalMod.get(),
    forceStart: opts.forceStart.get(),
    startBlock: opts.startBlock.get(),
    endBlock: opts.endBlock.get(),
    maxDUSDPerBlock: opts.maxDUSDPerBlock.get(),
    feeReserveAmount: opts.feeReserveAmount.get(),
  };
}
