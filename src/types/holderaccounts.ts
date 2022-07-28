export interface HolderAccount {
  walletId: string;
  totalAmount: number;
  mintIds: string[];
}

export interface HolderAccountMetadata {
  walletId: string;
  totalAmount: number;
  mints: any[];
}
