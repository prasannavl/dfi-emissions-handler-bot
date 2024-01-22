# dfi-emissions-handler-bot

DFI emissions handler bot

- Note: DO NOT use this for use-cases other than the intended ones just yet.
- The bot uses double precision floating point for most ops, which will quickly
  result in loss of precision and start approximating.
- It OK-ish for the intended use case of the bot for now. But this is a TODO.
- Once, shifted to native BigInt, then it can be used as much simpler framework
  for other things.
- Some eth* calls are baked in for quick testing only. Prefer ethers js instead
  to avoid precision loss.
