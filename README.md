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
- `deno task dev` - for auto reloading dev

## Notes

- All the logic is contained in `main.ts` and `impl.ts`
  - Everything else is just the framework scaffolds.
  - `DfiCli` proxies `defi-cli` and support for common items are built-in.
  - `DfiCli.setEvmProvider` sets the ethers context for EVM RPC that can be
    accessed through `DfiCli::evm`
  - `ethers` is also re-exported from `cli.ts` - so that you use the same
    version and mixed version conflicts.
  - Use the re-exported ethers for interacting with the EVM.
- Note: Use the cli driver for use-cases wider than the intended ones
  with heavy caution.
- It uses double precision floating point for many ops, which will quickly
  result in loss of precision and start approximating.
- It's OK-ish for the intended use case of the bot for now. But this is a TODO.
- Once shifted to native BigInt and arbitrary decimals, then it can be used as
  much simpler framework for other things.
- Some eth* calls are baked in for quick testing only. Prefer ethers js instead
  to avoid precision loss.
- Note: Floats are used in areas where we pass to DFI / BTC CLI. This doesn't accept
  beyond 8 decimal precision and will throw an error anyway if `toFixed(8)`
  can't represent this. Why it's safe-ish.
- Currently the used methods for the bot serialize them with `toFixed(8)` as
  needed (Eg: `PoolSwapArgs` goes through `makeSerializable` that's use
  `toFixed(8)` to round it.
- If this is too large to be expressible with `toFixed` and returns an
  exponential output, this will fail as they are methods that can't handle more
  precision on the BTC side. We don't use this for EVM.
- EVM related ones use etherjs / or floored after arithmetic ops to bigint. This
  should be switched to big decimal calc later.
