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
    public amount: TokenAmount,
    public from: Address,
    public to: Address,
    public domainFrom: TransferDomainType,
    public domainTo: TransferDomainType,
    public nonce: number | undefined = undefined,
    // Disabled due to a bug in the nonce, which makes nonce mandatory if
    // if singlekeycheck is specified.
    // public singleKeyCheck = false,
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

export enum AddressType {
  Legacy = "legacy",
  Bech32 = "bech32",
  Erc55 = "erc55",
  P2SHSegwit = "p2sh-segwit",
}

export class AccountToAccountArgs {
  constructor(
    public from: Address,
    public to: Address,
    public amount: TokenAmount,
  ) {}
}

export class BurnTokensArgs {
  constructor(
    public amounts: TokenAmount,
    public from: Address,
  ) {}
}

export class SendTokensToAddressArgs {
  public from: { [key: string]: string } = {};
  public to: { [key: string]: string } = {};

  constructor(
    amount: TokenAmount,
    fromAddress: string,
    toAddress: string,
    public selectionMode: SendTokensToAddressSelectionMode =
      SendTokensToAddressSelectionMode.Pie,
  ) {
    this.from[fromAddress] = amount.toString();
    this.to[toAddress] = amount.toString();
  }
}

export enum SendTokensToAddressSelectionMode {
  Forward = "forward",
  Crumbs = "crumbs",
  Pie = "pie",
}
