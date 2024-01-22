# dfi-emissions-handler-bot

DFI emissions handler bot

## Dev

### Steps

- Clone repo
- The only pre-requisite is [deno](https://deno.com).
- Use `.env` file to change params if needed.
- Run tasks below as needed.
- For all options and defaults see `opts.ts`

### Tasks

- `deno task run`- single execution of the program
- `deno task build` - to get a single deployable binary
- `deno fmt` - fmt code before checking in
- `deno task dev` - for reloading dev

## Notes

- All the logic is contained in `main.ts` and `impl.ts`
  - Everything is just the framework for setting things up.
  - `DfiCli` proxies `defi-cli` and support for common items are built-in.
  - `DfiCli.setEvmProvider` sets the ethers context for EVM RPC that can be
    accessed through `DfiCli.evm`
  - `ethers` is also re-exported from `cli.ts` - so that you use the same
    version and mixed version conflicts.
  - Use the re-exported ethers for interacting with the EVM.
- Note: DO NOT use this for use-cases other than the intended ones just yet.
- The bot uses double precision floating point for most ops, which will quickly
  result in loss of precision and start approximating.
- It OK-ish for the intended use case of the bot for now. But this is a TODO.
- Once, shifted to native BigInt, then it can be used as much simpler framework
  for other things.
- Some eth* calls are baked in for quick testing only. Prefer ethers js instead
  to avoid precision loss.

## TODOs

- Remove the use of floats for amount.
- Note: It's used in areas where we pass to DFI / BTC CLI. This doesn't accept
  beyond 8 decimal precision. It will throw an error.
- Currently, will result in loss of precision, but the used methods for the bot
  serialize them with `toFixed(8)` as needed (Eg: `PoolSwapArgs` goes through
  `makeSerializable` that's use `toFixed(8)` to round it.
- If this is too large to be expressible and returns and exp output, this will
  fail as they are methods that can't handle more precision on the BTC side.
- Rest are floored on multiply / divide on bigints. This can be switched to
  bigdecimals.
