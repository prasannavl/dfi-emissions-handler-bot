export class ValueType<T> {
  constructor(public value: T) {}
}

export function flattenValues(args: any) {
  if (args instanceof ValueType) {
    return args.value;
  }

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
    return this.amount() + "@" + this.token();
  }
}
