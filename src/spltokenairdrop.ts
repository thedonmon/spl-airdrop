import * as spl from '@solana/spl-token';
import { clusterApiUrl, sendAndConfirmTransaction, PublicKey, Transaction, SystemProgram, Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, transfer } from '@solana/spl-token';

export async function dropWLToken(whitelistPath: string, transferAmount: number){
    let jsonData: any = {};
    let walletArr: any = [];
    const data = fs.readFileSync(whitelistPath, "utf8");
    jsonData = JSON.parse(data);
    var connection = new Connection('https://divine-black-leaf.solana-mainnet.quiknode.pro/0a6e0f59227c91b2f1f72953090b46166790529d/');
    var secret = Keypair.fromSecretKey(Uint8Array.from(walletArr));
    var fromWallet = secret.publicKey;
    const mint = jsonData.mint as string;
    const addresses = jsonData.wallets as string[];
    const ownerAta = await spl.getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    let confirmMessages: string[] = [];
    const walletChunks = chunkItems(addresses, 5);
    for(var walletChunk of walletChunks) {
        walletChunk.map(async (toWallet, index) => {
            try {            
            const toWalletPk = new PublicKey(toWallet);
            const mintPk = new PublicKey(mint);
            const walletAta = await promiseRetry(() => spl.getOrCreateAssociatedTokenAccount(connection, secret, mintPk, toWalletPk, false, 'finalized', {skipPreflight: true, maxRetries: 100}, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
            console.log(toWallet, walletAta.amount, index);
            if(walletAta.amount < transferAmount) {
            const txnIns = spl.createTransferInstruction(ownerAta, walletAta.address, fromWallet, transferAmount, [secret], TOKEN_PROGRAM_ID);
            const txn = new Transaction().add(txnIns);
            const signature = await connection.sendTransaction(txn, [secret], {skipPreflight: true, maxRetries: 50});
            const sigresult = await connection.confirmTransaction(signature, 'finalized');
            console.log(toWallet, '\n');
            console.log(sigresult, '\n')
            let message = `Sent ${transferAmount} of ${mint} to ${toWallet}. Signature ${signature}`;
            confirmMessages.push(message);
            }
        }
        catch(err){
            console.log(err, toWallet);
        }
        });
        
    }
    const confirmMsgs = JSON.stringify(confirmMessages);
    fs.writeFileSync('tokentransfer.json', confirmMsgs);
    
}

async function promiseRetry<T>(fn: () => Promise<T>, retries = 5, err?: any): Promise<T> {
    console.log('trying transaction');
    if (err) {
        console.log('retrying ', retries);
        console.log(err);
    }
    await new Promise(resolve => setTimeout(resolve, (5 - retries) * 1000));

    return !retries ? Promise.reject(err) : fn().catch(error => promiseRetry(fn, (retries - 1), error));
}

export const chunkItems = <T>(items: T[], chunkSize?: number) =>
items.reduce((chunks: T[][], item: T, index) => {
  const chunkSz = chunkSize ?? 50;
  const chunk = Math.floor(index / chunkSz);
  chunks[chunk] = ([] as T[]).concat(chunks[chunk] || [], item);
  return chunks;
}, []);