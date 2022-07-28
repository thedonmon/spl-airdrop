import { Transaction, PublicKey } from '@solana/web3.js';
export interface Transfer {
  txn: Transaction;
  destination: PublicKey;
  mint: PublicKey;
}
