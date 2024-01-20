import { Address, TokenAmount } from "./common.ts";

export class SendToAddressArgs {
  constructor(
    public address: Address,
    public amount: number,
    public comment = "",
    public commentTo = "",
    public subtractFeeFromAmount = false,
  ) {}
}

export class AccountToUtxosArgs {
  constructor(
    public from: Address,
    public to: Address,
    public toAmount: number,
  ) {}
}

export class PoolSwapArgs {
  public to: Address;
  public amountFrom: number;

  constructor(
    public from: Address,
    public tokenFrom: string,
    public tokenTo: string,
    amount: number,
    to?: Address,
  ) {
    if (!to) {
      to = this.from;
    }
    this.amountFrom = amount;
    this.to = to;
  }
}

export enum TransferDomainType {
  Auto = 0,
  Utxo = 1,
  Dvm = 2,
  Evm = 3,
}

export class TransferDomainArgs {
  constructor(
    public from: Address,
    public amount: TokenAmount,
    public to: Address,
    public domainFrom: TransferDomainType,
    public domainTo: TransferDomainType,
  ) {
  }
}

export class EvmTxArgs {
  constructor(
    public from: Address,
    public to: Address,
    public amount: number,
    public nonce: number,
    public gasPrice: number,
    public gasLimit: number,
    public data: string,
  ) {
  }
}

export enum AddressMapKind {
  Auto = 0,
  DvmToErc55 = 1,
  Erc55ToDvm = 2,
}
