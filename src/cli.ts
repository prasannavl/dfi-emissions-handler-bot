import { BlockHeight, Address, TokenAmount, TxHash, BlockHash } from "./common.ts";
import { PoolSwapArgs, SendToAddressArgs, AccountToUtxosArgs, EvmTxArgs, TransferDomainArgs } from "./req.ts";
import { GetPoolPairResponse, GetBlockResponse, GetBlockResponseV0, GetBlockResponseV1, GetBlockResponseV2, GetTransactionResponse } from "./resp.ts";

export class DfiCli {
    public path: string;
    public args: string[];
    private _onEachBlockFuncs: Array<(height: BlockHeight) => Promise<void>> = [];
  
    constructor(cliPath?: string | null, ...args: string[]) {
      const defaultEvnPath = "/usr/bin/env";
      const defaultCliName = "defi-cli";
      if (cliPath) {
        this.path = cliPath;
      } else {
        const envPath = Deno.env.get("DEFI_CLI");
        if (envPath) {
          this.path = envPath;
        } else {
          this.path = defaultEvnPath;
        }
      }
      if (this.path === defaultEvnPath) {
        if (args.length < 1) {
          args = [defaultCliName];
        } else if (args[0] != defaultCliName) {
          args = [defaultCliName, ...args];
        }
      }
      this.args = args;
    }
  
    run(...args: string[]) {
      const finalArgs = [...this.args, ...args];
      // console.debug(finalArgs);
      return processRun(this.path, ...finalArgs);
    }
  
    output(...args: string[]) {
      const finalArgs = [...this.args, ...args];
      // console.debug(finalArgs);
      return processOutput(this.path, ...finalArgs);
    }
  
    async outputString(...args: string[]) {
      return (await this.output(...args)).toString();
    }
  
    async waitForBlock(minHeight?: BlockHeight) {
      let min = minHeight ? minHeight.value : 0;
      let current = (await this.getBlockHeight()).value;
      if (!min) { min = current + 1 }
  
      while (current < min) {
        await new Promise((res, _) => setTimeout(() => res(0), 30 * 1000));
        current = (await this.getBlockHeight()).value;
        // console.debug(`wait for block: ${min}, current: ${current}`);
      }
      return new BlockHeight(current);
    }
  
    addEachBlockEvent(func: (height: BlockHeight) => Promise<void>) {
      if (this._onEachBlockFuncs.indexOf(func) === -1)
        this._onEachBlockFuncs.push(func);
    }
  
    async runBlockEventLoop() {
      let onEachBlockFuncs = this._onEachBlockFuncs;
      let height = await this.getBlockHeight();
      while (onEachBlockFuncs.length > 0) {
        console.debug(`on each block event: ${height.value}`);
        for (const func of onEachBlockFuncs) {
          try {
            await func(height);
          } catch (err) {
            console.error(err);
          }
        }
        height = await this.waitForBlock(new BlockHeight(height.value + 1));
        onEachBlockFuncs = this._onEachBlockFuncs;
      }
    }
  
    async getNewAddress(): Promise<Address> {
      const res = await this.outputString("getnewaddress");
      return new Address(trimConsoleText(res));
    }
  
    async getBlockHeight(): Promise<BlockHeight> {
      const res = await this.outputString("getblockcount");
      const blocks = parseInt(trimConsoleText(res));
      if (!Number.isFinite(blocks))
        throw new Error("invalid numeric value returned");
      return new BlockHeight(blocks);
    }
  
    async getBalance() {
      const res = await this.outputString("getbalance");
      const resNum = parseFloat(trimConsoleText(res));
      if (!Number.isFinite(resNum))
        throw new Error(`invalid balance number: ${res}`);
      return resNum;
    }
  
    async getTokenBalances() {
      const res = await this.output("gettokenbalances", "{}", "false", "true");
      const resJson: string[] = res.json();
      return resJson.map(x => new TokenAmount(x));
    }
  
    async getPoolPair(poolPairIdOrName: string) {
      const res = await this.output("getpoolpair", poolPairIdOrName);
      const resJson = res.json();
      return resJson as GetPoolPairResponse;
    }
  
    async poolSwap(args: PoolSwapArgs) {
      const res = await this.outputString("poolswap",
        JSON.stringify(flattenValues(args)));
      return new TxHash(trimConsoleText(res));
    }
  
    async compositeSwap(args: PoolSwapArgs) {
      const res = await this.outputString("compositeswap",
        JSON.stringify(flattenValues(args)));
      return new TxHash(trimConsoleText(res));
    }
  
    async testPoolSwap(args: PoolSwapArgs) {
      const res = await this.outputString("testpoolswap",
        JSON.stringify(flattenValues(args)), "auto");
      return new TokenAmount(trimConsoleText(res));
    }
  
    async getBlockHash(args: BlockHeight) {
      const res = await this.outputString("getblockhash",
        args.value.toString());
      return new TxHash(trimConsoleText(res));
    }
  
    async getBlock(args: BlockHash, verbosity = 0): GetBlockResponse {
      if (verbosity > 2) throw new Error("unsupported verbosity");
      const res = await this.output("getblock",
        args.value.toString(), verbosity.toString());
      const resJson = res.json() as any;
      switch (verbosity) {
        case 0: return resJson as GetBlockResponseV0;
        case 1: return resJson as GetBlockResponseV1;
        case 2: return resJson as GetBlockResponseV2;
      }
    }
  
    async getTransaction(args: TxHash, includeWatchOnly = true) {
      const res = await this.output("gettransaction",
        args.value.toString(), includeWatchOnly.toString());
      return res.json() as GetTransactionResponse;
    }
  
    async invalidateBlock(args: BlockHash) {
      await this.outputString("invalidateblock",
        args.value.toString());
      return;
    }
  
    async waitForTx(args: TxHash) {
      while (true) {
        try {
          let tx = await this.getTransaction(args);
          return await this.getBlock(tx.blockhash).height;
        } catch (_) {}
        console.debug(`wait for tx: ${args.value}`);
        await this.waitForBlock();
      }
    }
  
    async sendToAddress(args: SendToAddressArgs) {
      const res = await this.outputString("sendtoaddress", args.address.value,
        args.amount.toString(), args.comment, args.commentTo, args.subtractFeeFromAmount.toString());
      return new TxHash(trimConsoleText(res));
    }
  
    async accountToUtxos(args: AccountToUtxosArgs) {
      const res = await this.outputString("accounttoutxos", args.from.value,
        JSON.stringify({ [args.to.value]: [TokenAmount.from(args.toAmount, "DFI").value] }));
      return new TxHash(trimConsoleText(res));
    }
  
    async evmTx(args: EvmTxArgs) {
      const res = await this.outputString("evmtx", args.from.value, args.nonce.toString(),
        args.gasPrice.toString(), args.gasLimit.toString(), args.to.value, args.amount.toString(), args.data);
      return new TxHash(trimConsoleText(res));
    }
  
    async transferDomain(args: TransferDomainArgs) {
      const param = JSON.stringify([{
        src: {
          address: args.from.value,
          amount: args.amount.toString(),
          domain: args.domainFrom
        },
        dst: {
          address: args.to.value,
          amount: args.amount.toString(),
          domain: args.domainTo
        },
        singlekeycheck: false
      }
      ]);
      const res = await this.outputString("transferdomain", param);
      return new TxHash(trimConsoleText(res));
    }
  }
  
  export async function processRun(...args: string[]) {
    return await (Deno.run({ cmd: [...args] }).status());
  }
  
  export async function processOutput(...args: string[]) {
    const p = Deno.run({
      cmd: [...args],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await p.status();
    if (result.code != 0) {
      throw new Error(new TextDecoder().decode(await p.stderrOutput()));
    }
    return new Output(new TextDecoder().decode(await p.output()));
  }
  
  export class Output {
    constructor(private _buf: string) { }
  
    toString() { return this._buf; }
    json() { return JSON.parse(this.toString()); }
  
    filterLine(predicate:
      (value: string, index: number, array: string[]) => unknown) {
      return this.toString()
        .split("\n")
        .filter(predicate)
        .join("\n");
    }
  }
  
  export function trimConsoleText(str: string) {
    return str.replace(/^\n*/g, "")
      .replace(/\n*$/g, "")
      .replace(/^\s*$/g, "");
  }