import { Account, Mint } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

export interface ITransferRequest<T> {
  toWallet: T;
  tokenMint?: PublicKey;
  connection: Connection;
  keypair: Keypair;
  totalTransferAmt?: number;
  ownerAta: PublicKey;
  fromWallet: PublicKey;
}

export interface TransferErrorRequest<T> extends ITransferRequest<T> {
  closeAccounts?: boolean;
}

export interface TransferErrorRequest<T> extends ITransferRequest<T> {
  closeAccounts?: boolean;
}

export interface TransferMintRequest<T> extends ITransferRequest<T> {
  mintObj: Mint;
  walletAta: Account;
  mintIfAuthority?: boolean;
}
