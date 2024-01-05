import * as web3Js from '@solana/web3.js';

export interface AirdropCliRequest {
  keypair: web3Js.Keypair;
  whitelistPath?: string;
  mintlistPath?: string;
  transferAmount: number;
  cluster?: string;
  rpcUrl?: string | null;
  simulate?: boolean;
  batchSize?: number;
  exclusionList?: string[];
  mintIfAuthority?: boolean;
  overrideBalanceCheck?: boolean;
}

export interface AirdropTypeRequest<T> extends AirdropCliRequest {
  holdersList?: T[];
  tokenMint?: web3Js.PublicKey;
  decimals?: number;
  transferAmount: number;
}
