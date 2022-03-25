import spl, { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as cliProgress from 'cli-progress';
import log from 'loglevel';
import chalk from 'chalk';
import { clusterApiUrl, PublicKey, Transaction, Keypair, Connection, Cluster, LAMPORTS_PER_SOL, ParsedAccountData } from '@solana/web3.js';
import * as fs from 'fs';
import { chunkItems, getConnection, promiseRetry, timeout } from './helpers/utility';
import { MintTransfer } from './types/mintTransfer';
import { MarketPlaces } from './helpers/constants';
import { HolderAccount } from './types/holderaccounts';
import { TransferError } from './types/errorTransfer';

export async function airdropToken(keypair: Keypair, whitelistPath: string, transferAmount: number, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false, batchSize: number = 5): Promise<any> {
    let jsonData: any = {};
    const data = fs.readFileSync(whitelistPath, "utf8");
    jsonData = JSON.parse(data);
    var connection = getConnection(cluster, rpcUrl);

    const fromWallet = keypair.publicKey;
    const mint = jsonData.mint as string;
    let addresses = jsonData.wallets as string[];
    addresses = filterMarketPlacesByWallet(addresses);
    if (simulate) {
        return addresses.map(x => ({ wallet: x, transferAmt: transferAmount }));
    }

    const progressBar = new cliProgress.SingleBar(
        {
            format: 'Progress: [{bar}] {percentage}% | {value}/{total}',
        },
        cliProgress.Presets.shades_classic,
    );

    progressBar.start(addresses.length, 0);
    const ownerAta = await spl.getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const walletChunks = chunkItems(addresses, batchSize);

    for (let walletChunk of walletChunks) {
        await Promise.all(walletChunk.map(async (toWallet, index) => {
            try {
                progressBar.increment();
                const toWalletPk = new PublicKey(toWallet);
                const mintPk = new PublicKey(mint);
                const walletAta = await promiseRetry(() => spl.getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'finalized', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
                if (walletAta.amount < transferAmount) {
                    const txnIns = spl.createTransferInstruction(ownerAta, walletAta.address, fromWallet, transferAmount, [keypair], TOKEN_PROGRAM_ID);
                    const txn = new Transaction().add(txnIns);
                    const signature = await connection.sendTransaction(txn, [keypair], { skipPreflight: true, maxRetries: 50 });
                    await connection.confirmTransaction(signature, 'finalized');
                    let message = `Sent ${transferAmount} of ${mint} to ${toWallet}. Signature ${signature}. \n`;
                    log.info(chalk.green(message));
                    fs.appendFileSync('tokentransfers.txt', message);
                }
                else {
                    log.warn(chalk.yellow(`${toWallet} already has token ${mint}`));
                }
            }
            catch (err) {
                const message = `ERROR: Sending ${transferAmount} of ${mint} to ${toWallet} failed. \n`;
                let errorMsg: TransferError = {
                    wallet: toWallet,
                    mint: mint,
                    transferAmount: transferAmount,
                    message: message,
                    error: err
                };
                log.error(chalk.red(message));
                fs.appendFileSync('tokentransfersnft-errors.txt', message);
                const errorString = fs.readFileSync('transfererror.json', 'utf-8');
                const jsonErrors = JSON.parse(errorString) as TransferError[];
                jsonErrors.push(errorMsg);
                const writeJson = JSON.stringify(jsonErrors);
                fs.writeFileSync('transfererror.json', writeJson);
            }
        }));
    }
}

export async function airdropTokenPerNft(keypair: Keypair, holdersList: HolderAccount[], tokenMint: PublicKey, decimals: number, transferAmount: number, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false, batchSize: number = 5): Promise<any> {
    var connection = getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    let holders: HolderAccount[] = filterMarketPlacesByHolders(holdersList);
    let decimalsToUse = getLamports(decimals);
    console.log(holders.length, holdersList.length);
    if (simulate) {
        return holders.map(x => ({ wallet: x, transferAmt: (transferAmount * x.mintIds.length) }));
    }

    const progressBar = new cliProgress.SingleBar(
        {
            format: 'Progress: [{bar}] {percentage}% | {value}/{total}',
        },
        cliProgress.Presets.shades_classic,
    );
    const ownerAta = await spl.getAssociatedTokenAddress(tokenMint, new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const walletChunks = chunkItems(holders, batchSize);
    progressBar.start(holders.length, 0);;

    for (let walletChunk of walletChunks) {
        await Promise.all(walletChunk.map(async (toWallet, index) => {
           
            const totalTransferAmt = transferAmount * toWallet.mintIds.length * decimalsToUse;
            try {
                progressBar.increment();
                await tryTransfer(toWallet, tokenMint, connection, keypair, totalTransferAmt, ownerAta, fromWallet);
            }
            catch (err) {
                const message = `ERROR: Sending ${totalTransferAmt} of ${tokenMint.toBase58()} to ${toWallet.walletId} failed. \n`;
                let errorMsg: TransferError = {
                    wallet: toWallet.walletId,
                    mint: tokenMint.toBase58(),
                    holdings: toWallet.totalAmount,
                    transferAmount: totalTransferAmt,
                    message: message,
                    error: err
                };
                log.error(chalk.red(message));
                fs.appendFileSync('tokentransfersnft-errors.txt', message);
                const errorString = fs.readFileSync('transfererror.json', 'utf-8');
                const jsonErrors = JSON.parse(errorString) as TransferError[];
                jsonErrors.push(errorMsg);
                const writeJson = JSON.stringify(jsonErrors);
                fs.writeFileSync('transfererror.json', writeJson);
            }
        }));
    }
}


export async function airdropNft(keypair: Keypair, whitelistPath: string, mintlistPath: string, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false, batchSize: number = 5): Promise<any> {
    let jsonData: any = {};
    const data = fs.readFileSync(whitelistPath, "utf8");
    const mintlist = fs.readFileSync(mintlistPath, "utf8");
    jsonData = JSON.parse(data);
    const mintListArr = JSON.parse(mintlist) as string[];
    const connection = getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    const distributionList = jsonData.distributionList as any[]

    let mintsTransferList: MintTransfer[] = [];
    for (let distro of distributionList) {
        const mintsToTransfer = mintListArr.splice(0, distro.nFtsToAirdrop);
        const mintsObj = mintsToTransfer.map(x => new MintTransfer(distro.wallet, x));
        mintsTransferList.concat(mintsObj);
    }
    mintsTransferList = filterMarketPlaces(mintsTransferList);
    if (simulate) {
        return mintsTransferList;
    }
    const mintTransferChunks = chunkItems(mintsTransferList, batchSize);
    for (let mintTransferChunk of mintTransferChunks) {
        await Promise.all(mintTransferChunk.map(async (mint, index) => {
            try {
                const ownerAta = await spl.getAssociatedTokenAddress(new PublicKey(mint.mintId), new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
                const signature = await tryTransferMint(mint, connection, keypair, 1, ownerAta, fromWallet);
                let message = `Sent NFT ${mint.mintId} to ${mint.wallet}. Signature ${signature}.`;
                log.info(chalk.green(message));
            }
            catch (err: any) {
                const message = `ERROR: Failed to send NFT ${mint.mintId} to ${mint.wallet}.`;
                let errorMsg: TransferError = {
                    wallet: mint.wallet,
                    mint: mint.mintId,
                    transferAmount: 1,
                    message: message,
                    error: err
                };
                log.error(chalk.red(message));
                fs.appendFileSync('tansfers-nft-errors.txt', message);
                const errorString = fs.readFileSync('transfererror.json', 'utf-8');
                const jsonErrors = JSON.parse(errorString) as TransferError[];
                jsonErrors.push(errorMsg);
                const writeJson = JSON.stringify(jsonErrors);
                fs.writeFileSync('transfererror.json', writeJson);
            }
        }));

    }
}

async function tryTransfer(toWallet: HolderAccount, tokenMint: PublicKey, connection: Connection, keypair: Keypair, totalTransferAmt: number, ownerAta: PublicKey, fromWallet: PublicKey): Promise<any> {
    const toWalletPk = new PublicKey(toWallet.walletId);
    const mintPk = tokenMint;;
    const walletAta = await promiseRetry(() => spl.getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'finalized', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
    const txnIns = spl.createTransferInstruction(ownerAta, walletAta.address, fromWallet, totalTransferAmt, [keypair], TOKEN_PROGRAM_ID);
    const txn = new Transaction().add(txnIns);
    const signature = await connection.sendTransaction(txn, [keypair], { skipPreflight: true, maxRetries: 100 });
    await connection.confirmTransaction(signature, 'finalized');
    let message = `Sent ${totalTransferAmt} of ${tokenMint.toBase58()} to ${toWallet.walletId}. Signature ${signature}. \n`;
    log.info(chalk.green(message));
    fs.appendFileSync('tokentransfers.txt', message);

}

async function tryTransferMint(toWallet: MintTransfer, connection: Connection, keypair: Keypair, totalTransferAmt: number, ownerAta: PublicKey, fromWallet: PublicKey): Promise<any> {
    const toWalletPk = new PublicKey(toWallet.wallet);
    const mintPk = new PublicKey(toWallet.mintId);
    const walletAta = await promiseRetry(() => spl.getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'finalized', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
    const txnIns = spl.createTransferInstruction(ownerAta, walletAta.address, fromWallet, totalTransferAmt, [keypair], TOKEN_PROGRAM_ID);
    const txn = new Transaction().add(txnIns);
    const signature = await connection.sendTransaction(txn, [keypair], { skipPreflight: true, maxRetries: 100 });
    await connection.confirmTransaction(signature, 'finalized');
    let message = `Sent ${totalTransferAmt} of ${mintPk.toBase58()} to ${toWallet.wallet}. Signature ${signature}. \n`;
    log.info(chalk.green(message));
    fs.appendFileSync('transfernft.txt', message);
    return signature;

}

function filterMarketPlaces(transfers: MintTransfer[]): MintTransfer[] {
    return transfers.filter(x => isNotMarketPlace(x.wallet));
}

function filterMarketPlacesByHolders(transfers: HolderAccount[]): HolderAccount[] {
    return transfers.filter(x => isNotMarketPlace(x.walletId));
}

function filterMarketPlacesByWallet(wallets: string[]): string[] {
    return wallets.filter(x => isNotMarketPlace(x));
}

function isNotMarketPlace(walletId: string): boolean {
    return walletId != MarketPlaces.MagicEden && walletId != MarketPlaces.AlphaArt && walletId != MarketPlaces.DigitalEyes && walletId != MarketPlaces.ExchangeArt && walletId != MarketPlaces.Solanart
}

function getLamports(decimal: number): number {
    if(decimal == 9) {
        return LAMPORTS_PER_SOL;
    }
    else if (decimal == 0){
        return 1;
    }
    else {
        let amount = 0;
        switch(decimal){
            case 8:
                amount = 1_000_000_00;
                break;
            case 7:
                amount = 1_000_000_0;
                break;
            case 6:
                amount = 1_000_000;
                break;
            case 5: 
                amount = 1_000_00;
                break; 
            case 4: 
                amount = 1_000_0;
                break; 
            case 3: 
                amount = 1_000;
                break; 
            case 2: 
                amount = 1_00;
                break; 
            case 1: 
                amount = 1_0;
                break; 
        }
        return amount;
    }

}

async function filterRecentTransactions(pk: PublicKey, filterAddress: string, connection: Connection): Promise<(string | undefined)[]> {
    const txns = await connection.getConfirmedSignaturesForAddress2(pk, { limit: 1000 }, 'finalized');
    const txnsParsed = await connection.getParsedTransactions(txns.map(x => x.signature));
    const txnsP = txnsParsed.filter(x => x?.transaction.message.accountKeys!.filter(s => s.pubkey.toBase58() == filterAddress));
    const filteredFound = txnsP.flatMap(x => x?.transaction.message.accountKeys.flatMap(k => k.pubkey.toBase58())).filter(s => s == filterAddress);
    return filteredFound;
}