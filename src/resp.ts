import { TokenAmount } from "./common.ts";
import { AddressMapKind } from "./req.ts";

export interface GetPoolPairResponse {
  [id: string]: {
    symbol: string;
    name: string;
    status: boolean;
    idTokenA: string;
    idTokenB: string;
    dexFeePctTokenA: number;
    dexFeeInPctTokenA: number;
    reserveA: number;
    reserveB: number;
    commission: number;
    totalLiquidity: number;
    "reserveA/reserveB": number;
    "reserveB/reserveA": number;
    tradeEnabled: boolean;
    ownerAddress: string;
    blockCommissionA: number;
    blockCommissionB: number;
    rewardPct: number;
    rewardLoanPct: number;
    creationTx: string;
    creationHeight: number;
  };
}

export interface GetTransactionResponse {
  amount: number;
  fee: number;
  confirmations: number;
  blockhash: string;
  blockindex: number;
  blocktime: number;
  txid: string;
  walletconflicts: any[];
  time: number;
  timereceived: number;
  "bip125-replaceable": string;
  details: GetTransactionResponseDetails[];
  hex?: string;
}

export interface GetTransactionResponseDetails {
  category: string;
  amount: number;
  vout: number;
  fee?: number;
  abandoned?: boolean;
  address?: string;
  label?: string;
}

export type GetBlockResponse =
  | GetBlockResponseV0
  | GetBlockResponseV1
  | GetBlockResponseV2;
export type GetBlockResponseV0 = string;
export interface GetBlockResponseV1 {
  hash: string;
  confirmations: number;
  strippedsize: number;
  size: number;
  weight: number;
  height: number;
  masternode: string;
  minter: string;
  mintedBlocks: number;
  stakeModifier: string;
  version: number;
  versionHex: string;
  merkleroot: string;
  nonutxo: GetBlockResponseNonUtxo[];
  tx: string[];
  time: number;
  mediantime: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash: string;
  nextblockhash: string;
}

export interface GetBlockResponseNonUtxo {
  AnchorReward: number;
  CommunityDevelopmentFunds: number;
  Burnt: number;
}

export interface GetBlockResponseV2 {
  hash: string;
  confirmations: number;
  strippedsize: number;
  size: number;
  weight: number;
  height: number;
  masternode: string;
  minter: string;
  mintedBlocks: number;
  stakeModifier: string;
  version: number;
  versionHex: string;
  merkleroot: string;
  nonutxo: GetBlockResponseNonUtxo[];
  tx: TxResponse[];
  time: number;
  mediantime: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash: string;
  nextblockhash: string;
}

export interface TxResponse {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: VinResponse[];
  vout: VoutResponse[];
  hex: string;
}

export interface VinResponse {
  coinbase: string;
  sequence: number;
}

export interface VoutResponse {
  value: number;
  n: number;
  scriptPubKey: ScriptPubKeyResponse;
  tokenId: number;
}

export interface ScriptPubKeyResponse {
  asm: string;
  hex: string;
  reqSigs?: number;
  type: string;
  addresses?: string[];
}

export type GetTokenBalancesResponse =
  | GetTokenBalancesResponseArray
  | GetTokenBalancesResponseDecoded;

export type GetTokenBalancesResponseArray = TokenAmount[];

export interface GetTokenBalancesResponseDecoded {
  [key: string]: number;
}

export interface AddressMapResponse {
  input: string;
  type: AddressMapKind;
  format: {
    [key: string]: string;
  };
}
