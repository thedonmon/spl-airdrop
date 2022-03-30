export interface TransferError {
    wallet: string,
    mint: string,
    transferAmount: number,
    isNFT?: boolean,
    signature? : string,
    holdings?: number,
    message?: string
    error?: any;
    
}