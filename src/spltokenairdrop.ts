import * as spl from '@solana/spl-token';
import * as cliProgress from 'cli-progress';
import { clusterApiUrl, PublicKey, Transaction, Keypair, Connection, Cluster } from '@solana/web3.js';
import * as fs from 'fs';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, transfer } from '@solana/spl-token';
import { chunkItems, getConnection, promiseRetry } from './helpers/utility';
import { MintTransfer } from './types/mintTransfer';

export async function airdropToken(keypair: Keypair, whitelistPath: string, transferAmount: number, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false): Promise<any> {
    let jsonData: any = {};
    const data = fs.readFileSync(whitelistPath, "utf8");
    jsonData = JSON.parse(data);
    var connection = getConnection(cluster, rpcUrl);
    
    const fromWallet = keypair.publicKey;
    const mint = jsonData.mint as string;
    const addresses = jsonData.wallets as string[];
    if(simulate) {
        return addresses.map(x => ({  wallet: x, transferAmt: transferAmount }));
    }

    const progressBar = new cliProgress.SingleBar(
        {
            format: 'Progress: [{bar}] {percentage}% | {value}/{total}',
        },
        cliProgress.Presets.shades_classic,
    );

    progressBar.start(addresses.length, 0);
    const ownerAta = await spl.getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const walletChunks = chunkItems(addresses, 5);
    const stream = fs.createWriteStream("tokentransfers.txt", { flags: 'a' });
    for (let walletChunk of walletChunks) {
        progressBar.increment(walletChunk.length);
        walletChunk.map(async (toWallet, index) => {
            try {
                const toWalletPk = new PublicKey(toWallet);
                const mintPk = new PublicKey(mint);
                const walletAta = await promiseRetry(() => spl.getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'finalized', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
                console.log(toWallet, walletAta.amount, index);
                if (walletAta.amount < transferAmount) {
                    const txnIns = spl.createTransferInstruction(ownerAta, walletAta.address, fromWallet, transferAmount, [keypair], TOKEN_PROGRAM_ID);
                    const txn = new Transaction().add(txnIns);
                    const signature = await connection.sendTransaction(txn, [keypair], { skipPreflight: true, maxRetries: 50 });
                    await connection.confirmTransaction(signature, 'finalized');
                    let message = `Sent ${transferAmount} of ${mint} to ${toWallet}. Signature ${signature}. \n`;
                    stream.write(message);
                }
            }
            catch (err) {
                const message = `ERROR: Sending ${transferAmount} of ${mint} to ${toWallet} failed. \n`;
                stream.write(message);
                console.error(err, message);
            }
        });
    }

}

export async function transferNft(keypair: Keypair, whitelistPath: string, mintlistPath: string, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false): Promise<any> {
    let jsonData: any = {};
    const data = fs.readFileSync(whitelistPath, "utf8");
    const mintlist = fs.readFileSync(mintlistPath, "utf8");
    jsonData = JSON.parse(data);
    const mintListArr = JSON.parse(mintlist) as string[];
    const connection = getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    const distributionList = jsonData.distributionList as any[];
    const progressBar = new cliProgress.SingleBar(
        {
            format: 'Progress: [{bar}] {percentage}% | {value}/{total}',
        },
        cliProgress.Presets.shades_classic,
    );
    progressBar.start(distributionList.length, 0);
    const stream = fs.createWriteStream("nfttransfer.txt", { flags: 'a' });
    let mintsTransferList: MintTransfer[] = [];
    for (let distro of distributionList) {
        const mintsToTransfer = mintListArr.splice(0, distro.nFtsToAirdrop);
        const mintsObj = mintsToTransfer.map(x => new MintTransfer(distro.wallet, x));
        mintsTransferList.concat(mintsObj);
    }
    if(simulate) {
        stream.close();
        return mintsTransferList;
    }
    const mintTransferChunks = chunkItems(mintsTransferList, 5);
    for (let mintTransferChunk of mintTransferChunks) {
        progressBar.increment(mintTransferChunk.length);
        mintTransferChunk.map(async (mint, index) => {
            try {
                const ownerAta = await spl.getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
                const toWalletPk = new PublicKey(mint.mintId);
                const mintPk = new PublicKey(mint);
                const walletAta = await promiseRetry(() => spl.getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'finalized', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
                const txnIns = spl.createTransferInstruction(ownerAta, walletAta.address, fromWallet, 1, [keypair], TOKEN_PROGRAM_ID);
                const txn = new Transaction().add(txnIns);
                const signature = await connection.sendTransaction(txn, [keypair], { skipPreflight: true, maxRetries: 50 });
                await connection.confirmTransaction(signature, 'finalized');
                let message = `Sent NFT ${mint} to ${mint.wallet}. Signature ${signature}. \n`;
                stream.write(message);
            }
            catch (err: any) {
                const message = `ERROR: Failed to send NFT ${mint} to ${mint.wallet}. \n`;
                stream.write(message);
                console.error(err, message);
            }
        });
    
    }
}