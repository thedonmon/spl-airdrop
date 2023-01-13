export interface TransactionAudit {
  TransactionSignature: string;
  WalletId: string;
  AmountPaid?: string;
  TokenAllocation: string;
}

export interface TransactionAuditResponse {
  TransactionSignature: string;
  FromWallet: string;
  ToWallet: string;
  AmountPaid: number;
  Unit: string;
  DestPreBalance: number;
  DestPostBalance: number;
  OriginPreBalance: number;
  OriginPostBalance: number;
  BlockTime?: number | null;
  Slot: number;
  BlockConfirmation: string;
  TokenAllocation: string;
  ExpectedAmount?: number;
}