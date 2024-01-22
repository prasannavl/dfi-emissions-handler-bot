export class ValueType<T> {
  constructor(public value: T) {}
}

export class Address extends ValueType<string> {}
export class BlockHeight extends ValueType<number> {}
export class Hash extends ValueType<string> {}
export class TxHash extends Hash {}
export class BlockHash extends Hash {}

export class TokenAmount extends ValueType<string> {
  private _token;
  private _amount;

  constructor(amountWithToken: string) {
    super(amountWithToken);
    const res = amountWithToken.split("@");
    if (res.length != 2) {
      this._throwInvalidFormatError();
    }
    const [amount, token] = [parseFloat(res[0]), res[1]];
    if (token.length < 1 || token.length > 8) {
      this._throwInvalidFormatError();
    }
    if (!Number.isFinite(amount) && amount < 0) {
      this._throwInvalidFormatError();
    }
    this._token = token;
    this._amount = amount;
    this.value = this.toString();
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

  token() {
    return this._token;
  }
  amount() {
    return this._amount;
  }
  toString() {
    return this.amount().toFixed(8) + "@" + this.token();
  }
}

export function makeSerializable(args: any) {
  if (args instanceof ValueType) {
    return args.value;
  }

  // Set max. precision to 8 or most numerics
  // will fail.
  if (typeof args === "number") {
    return args.toFixed(8);
  }

  const res: any = {};
  for (const propName in args) {
    const prop = args[propName];
    if (prop instanceof ValueType) {
      res[propName] = prop.value;
    } else if (typeof prop === "number") {
      res[propName] = prop.toFixed(8);
    } else {
      res[propName] = prop;
    }
  }
  return res;
}

// TODO: Use BigInt for these soon
// For the purpose of this bot, it may be ok-ish
// to get everything up and running,
// but will very quickly fall over losing precision
export class Amount {
  private _wei: number;
  constructor(wei: number) {
    this._wei = wei;
  }

  static fromUnit(unit: number) {
    return new Amount(unit * 1e18);
  }

  static fromSats(sats: number) {
    return new Amount(sats * 1e10);
  }

  static fromGwei(gwei: number) {
    return new Amount(gwei * 1e9);
  }

  wei() {
    return this._wei;
  }

  gwei() {
    return this._wei * 1e-9;
  }

  sats() {
    return this._wei * 1e-10;
  }

  unit() {
    return this._wei * 1e-18;
  }

  toString() {
    return this.unit();
  }
}

// Note that this method will lose precision.
// We want to be using big ints for ops that can't
// accept the loss of accuracy
export function hexToDecimal(hex: string) {
  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }
  return parseInt(hex, 16);
}

export function decimalToHex(dec: number, prefix0x = true) {
  return prefix0x ? "0x" : "" + dec.toString(16);
}

// https://github.com/DeFiCh/ain/blob/ce178e6711de32390ed3d166e4b1d7012bc853b2/lib/ain-contracts/src/lib.rs#L84
export function dst20TokenIdToAddress(tokenId: number): Address {
  const hexStr = decimalToHex(tokenId, false);
  const str = `0xff${hexStr.padStart(38, "0")}`;
  return new Address(str);
}

export function patchConsoleLogWithTime() {
  const origLog = console.log;
  Object.defineProperty(console, "log", {
    get: function () {
      return Function.prototype.bind.call(origLog, console, new Date());
    },
  });
}
