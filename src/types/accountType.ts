export type ParsedAccountDataType = {
  info: Info;
  type: string;
};

export type Info = {
  isNative: boolean;
  mint: string;
  owner: string;
  state: string;
  tokenAmount: TokenAmount;
};

export type TokenAmount = {
  amount: string;
  decimals: number;
  uiAmount: number;
  uiAmountString: string;
};
