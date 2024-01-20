#!/usr/bin/env -S deno run --allow-env --allow-run --allow-net

import * as path from "std/path/mod.ts";

class DfiCli {
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
            console.debug(`wait for block: ${min}, current: ${current}`);
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

    async invalidateBlock(args: TxHash) {
        const res = await this.outputString("invalidateblock",
            args.value.toString());
        return;
    }

    async sendToAddress(args: SendToAddressArgs) {
        const res = await this.outputString("sendtoaddress", args.address.value,
            args.amount.toString(), args.comment, args.commentTo, args.subtractFeeFromAmount.toString());
        return new TxHash(trimConsoleText(res));
    }

    async accountToUtxos(args: AccountToUtxosArgs) {
      const res = await this.outputString("accounttoutxos", args.from.value, 
      JSON.stringify({ [args.to.value]: [ TokenAmount.from(args.toAmount, "DFI").value ] }));
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
              domain: args.domainTo }, 
              singlekeycheck: false 
          }
          ]);
      const res = await this.outputString("transferdomain", param);
      return new TxHash(trimConsoleText(res));
  }
}

async function processRun(...args: string[]) {
  return await (Deno.run({ cmd: [...args]}).status());
}

async function processOutput(...args: string[]) {
  const p = Deno.run({
      cmd: [...args],
      stdout: "piped",
  });
  const result = await p.status();
  if (result.code != 0) {
      throw new Error("process failed");
  }
  return new Output(new TextDecoder().decode(await p.output()));
}

class Output {
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

function trimConsoleText(str: string) {
  return str.replace(/^\n*/g, "")
      .replace(/\n*$/g, "")
      .replace(/^\s*$/g, "");
}


class ValueType<T> {
    constructor(public value: T) {}
}

function flattenValues(args: any) {
    if (args instanceof ValueType)
        return args.value;

    const res: any = {};
    for (const propName in args) {
        const prop = args[propName];
        if (prop instanceof ValueType) {
            res[propName] = prop.value;
        } else {
            res[propName] = prop;
        }
    }
    return res;
}

class Address extends ValueType<string> {}
class BlockHeight extends ValueType<number> {}
class TxHash extends ValueType<string> {}

class TokenAmount extends ValueType<string> {
    private _token;
    private _amount;

    constructor(amountWithToken: string) {
        super(amountWithToken);
        const res = amountWithToken.split("@");
        if (res.length != 2)
            this._throwInvalidFormatError();
        const [amount, token] = [parseFloat(res[0]), res[1]];
        if (token.length < 1 || token.length > 8)
            this._throwInvalidFormatError();
        if (!Number.isFinite(amount) && amount < 0)
            this._throwInvalidFormatError();
        this._token = token;
        this._amount = amount;
    }

    static from(amount: number, token: string) {
      const res = Object.create(this.prototype);
      res._token = token;
      res._amount = amount;
      res.value = res.toString();
      return res;
    }

    private _throwInvalidFormatError() {
        throw new Error("invalid token value format");
    }

    token() { return this._token; }
    amount() { return this._amount; }
    toString() { return this.amount() + "@" + this.token(); }
}

class SendToAddressArgs {
  constructor(public address: Address, public amount: number, 
    public comment = "", public commentTo = "", 
    public subtractFeeFromAmount = false) {}
}

class AccountToUtxosArgs {
    constructor(public from: Address, public to: Address, public toAmount: number) {};
}

class PoolSwapArgs {
    public to: Address;
    public amountFrom: number;

    constructor(
        public from: Address,
        public tokenFrom: string,
        public tokenTo: string,
        amount: number,
        to?: Address) {
        if (!to) {
            to = this.from;
        }
        this.amountFrom = amount;
        this.to = to;
    }
}

enum TransferDomainKind {
  DVM = 2,
  EVM = 3
}

class TransferDomainArgs {
  constructor(
      public from: Address,
      public amount: TokenAmount,
      public to: Address,
      public domainFrom: TransferDomainKind,
      public domainTo: TransferDomainKind) {
  }
}

async function main() {
    const cli = new DfiCli(null, "-testnet");
    console.log(`DEFI_CLI: ${cli.path} ${cli.args.join(" ")}`);

    while (true) {
        const height = await cli.getBlockHeight();
        console.log('height', height)

        await cli.waitForBlock();
    }
}

main();
