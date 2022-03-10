import { IMintTransfer } from "./imintTransfer";

export class MintTransfer implements IMintTransfer{
    public wallet: string;
    public mintId: string;
    constructor(wallet: string, mintId: string){
        this.mintId = wallet;
        this.wallet = mintId;
    }
}