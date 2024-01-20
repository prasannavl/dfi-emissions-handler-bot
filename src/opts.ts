import { load } from "std/dotenv/mod.ts";
export async function loadEnvOptions() {
    class Option<T> {
      constructor(public env: string, public defaultValue: string,
        public required = false, public transformFn: ((v: string) => T)) {
      }
  
      get() {
        const v = Deno.env.get(this.env);
        if (this.required && !v) {
          throw new Error(`env ${this.env} REQUIRED`);
        }
        return this.transformFn(v || this.defaultValue);
      }
    }
  
    await load({ export: true });
  
    const opts = {
      emissionsAddr: new Option("BOT_EMISSIONS_ADDRESS", "", true, v => v),
      evmAddr1: new Option("BOT_EVM_ADDR_YEAR_1", "", true, v => v),
      evmAddr2: new Option("BOT_EVM_ADDR_YEAR_2", "", true, v => v),
      runIntervalMod: new Option("BOT_RUN_INTERVAL_MOD", "2", false, parseInt),
      forceStart: new Option("BOT_FORCE_START", "false", false, v => v === "true" || v === "1"),
      startBlock: new Option("BOT_START_BLOCK", "1300000", false, parseInt),
      endBlock: new Option("BOT_END_BLOCK", "-1", false, v => v === "-1" ? Number.MAX_VALUE : parseInt(v)),
    };
  
    return {
      emissionsAddr: opts.emissionsAddr.get(),
      evmAddr1: opts.evmAddr1.get(),
      evmAddr2: opts.evmAddr2.get(),
      runIntervalMod: opts.runIntervalMod.get(),
      forceStart: opts.forceStart.get(),
      startBlock: opts.startBlock.get(),
      endBlock: opts.endBlock.get(),
    };
  }