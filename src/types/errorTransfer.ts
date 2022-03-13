export interface TransferError {
    wallet: string,
    mint: string,
    transferAmount: number,
    signature? : string,
    holdings?: number,
    message?: string
    error?: any;
    
}