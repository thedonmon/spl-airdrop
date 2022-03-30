import { IMintTransfer } from "./imintTransfer";

export class MintTransfer implements IMintTransfer{
    public wallet: string;
    public mintId: string;
    constructor(wallet: string, mintId: string){
        this.mintId = mintId;
        this.wallet = wallet;
    }
}