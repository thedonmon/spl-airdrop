import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getAccount,
    getOrCreateAssociatedTokenAccount,
    createTransferInstruction,
    createCloseAccountInstruction,
    mintTo,
    getMint
} from '@solana/spl-token';
import * as cliProgress from 'cli-progress';
import _, { split } from 'lodash';
import log from 'loglevel';
import chalk from 'chalk';
import { clusterApiUrl, PublicKey, Transaction,
     Keypair, Connection, Cluster, 
     LAMPORTS_PER_SOL, 
     ParsedAccountData, sendAndConfirmTransaction,
 } from '@solana/web3.js';
import * as fs from 'fs';
import { chunkItems, elapsed, getConnection, now, promiseRetry, timeout } from './helpers/utility';
import { MintTransfer } from './types/mintTransfer';
import { LogFiles, MarketPlaces } from './helpers/constants';
import { HolderAccount } from './types/holderaccounts';
import { TransferError } from './types/errorTransfer';
import { Transfer } from './types/transfer';
import { Distribution } from './types/distribution';
import { ParsedAccountDataType } from './types/accountType';

export async function airdropToken(keypair: Keypair, whitelistPath: string, transferAmount: number, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false, batchSize: number = 250, exclusionList: string[] = []): Promise<any> {
    let jsonData: any = {};
    const data = fs.readFileSync(whitelistPath, "utf8");
    jsonData = JSON.parse(data);
    var connection = getConnection(cluster, rpcUrl);

    const fromWallet = keypair.publicKey;
    const mint = jsonData.mint as string;
    let addresses = jsonData.wallets as string[];
    addresses = filterMarketPlacesByWallet(addresses);
    if(exclusionList.length > 0) {
        addresses = addresses.filter(item => !exclusionList.includes(item));
    }
    if (simulate) {
        return addresses.map(x => ({ wallet: x, transferAmt: transferAmount }));
    }

    const progressBar = getProgressBar();

    progressBar.start(addresses.length, 0);
    const ownerAta = await getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const walletChunks = chunkItems(addresses, batchSize);

    for (let walletChunk of walletChunks) {
        await Promise.all(walletChunk.map(async (toWallet, index) => {
            let start = now();
            try {
                const toWalletPk = new PublicKey(toWallet);
                const mintPk = new PublicKey(mint);
                const mintObj = await getMint(connection, mintPk, 'confirmed', TOKEN_PROGRAM_ID);
                const walletAta = await promiseRetry(() => getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'confirmed', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
                if (walletAta.amount < transferAmount) {
                    let signature = '';
                    if (mintObj.mintAuthority?.toBase58() == keypair.publicKey.toBase58()) {
                        signature = await mintTo(connection, keypair, mintObj.address, walletAta.address, keypair, transferAmount, undefined, { commitment: 'confirmed', skipPreflight: true, maxRetries: 100, }, TOKEN_PROGRAM_ID);
                    }
                    else {
                        const txnIns = createTransferInstruction(ownerAta, walletAta.address, fromWallet, transferAmount, [keypair], TOKEN_PROGRAM_ID);
                        const txn = new Transaction().add(txnIns);
                        txn.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
                        txn.feePayer = fromWallet;
                        signature = await connection.sendTransaction(txn, [keypair], { skipPreflight: true, maxRetries: 50 });
                        await connection.confirmTransaction(signature, 'finalized');
                    }
                    let message = `Sent ${transferAmount} of ${mint} to ${toWallet}. Signature ${signature}. \n`;
                    log.info(chalk.green(message));
                    fs.appendFileSync('tokentransfers.txt', message);
                }
                else {
                    log.warn(chalk.yellow(`${toWallet} already has token ${mint}`));
                }
            }
            catch (err: any) {
                const message = `ERROR: Sending ${transferAmount} of ${mint} to ${toWallet} failed. \n`;
                let errorMsg: TransferError = {
                    wallet: toWallet,
                    mint: mint,
                    transferAmount: transferAmount,
                    message: message,
                    error: err.message
                };
                log.error(chalk.red(message));
                fs.appendFileSync(LogFiles.TokenTransferErrorsTxt, message);
                const errorString = fs.readFileSync(LogFiles.TransferErrorJson, 'utf-8');
                const jsonErrors = JSON.parse(errorString) as TransferError[];
                jsonErrors.push(errorMsg);
                const writeJson = JSON.stringify(jsonErrors);
                fs.writeFileSync(LogFiles.TransferErrorJson, writeJson);
            }
            finally {
                progressBar.increment();
                elapsed(start, true, log);
            }
        }));
    }
    progressBar.stop();
    Promise.resolve();
}

export async function airdropTokenPerNft(keypair: Keypair, holdersList: HolderAccount[], tokenMint: PublicKey, decimals: number, transferAmount: number, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false, batchSize: number = 50, exclusionList: string[] = []): Promise<any> {
    var connection = getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    let holders: HolderAccount[] = filterMarketPlacesByHolders(holdersList);
    let decimalsToUse = getLamports(decimals);
    console.log(holders.length, holdersList.length);
    if(exclusionList.length > 0) {
        holders = holders.filter(item => !exclusionList.includes(item.walletId));
    }
    if (simulate) {
        return holders.map(x => {return { wallet: x.walletId, transferAmt: (transferAmount * x.totalAmount * decimalsToUse) }});
    }

    const progressBar = getProgressBar();
    const ownerAta = await getAssociatedTokenAddress(tokenMint, new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const walletChunks = chunkItems(holders, batchSize);
    progressBar.start(holders.length, 0);

    for (let walletChunk of walletChunks) {
        await Promise.all(walletChunk.map(async (toWallet, index) => {
            let start = now();
            const totalTransferAmt = transferAmount * toWallet.totalAmount * decimalsToUse;
            try {
                await tryTransfer(toWallet, tokenMint, connection, keypair, totalTransferAmt, ownerAta, fromWallet);
            }
            catch (err: any) {
                const message = `ERROR: Sending ${totalTransferAmt} of ${tokenMint.toBase58()} to ${toWallet.walletId} failed. \n`;
                let errorMsg: TransferError = {
                    wallet: toWallet.walletId,
                    mint: tokenMint.toBase58(),
                    holdings: toWallet.totalAmount,
                    transferAmount: totalTransferAmt,
                    message: message,
                    error: err.message
                };
                log.error(chalk.red(message));
                fs.appendFileSync(LogFiles.TokenTransferNftTxt, message);
                const errorString = fs.readFileSync(LogFiles.TransferErrorJson, 'utf-8');
                const jsonErrors = JSON.parse(errorString) as TransferError[];
                jsonErrors.push(errorMsg);
                const writeJson = JSON.stringify(jsonErrors);
                fs.writeFileSync(LogFiles.TransferErrorJson, writeJson);
            }
            finally {
                progressBar.increment();
                elapsed(start, true, log);
            }
        }));
    }
    progressBar.stop();
    Promise.resolve();
}


export async function airdropNft(keypair: Keypair, whitelistPath: string, mintlistPath: string, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false, batchSize: number = 50): Promise<any> {
    let jsonData: any = {};
    const data = fs.readFileSync(whitelistPath, "utf8");
    const mintlist = fs.readFileSync(mintlistPath, "utf8");
    jsonData = JSON.parse(data);
    const mintListArr = JSON.parse(mintlist) as string[];
    const connection = getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    const distributionList = jsonData.distributionList as any[];
    let mintsTransferList: MintTransfer[] = [];
    console.log(distributionList);
    for (let distro of distributionList) {
        const mintsToTransfer = mintListArr.splice(0, distro.nFtsToAirdrop);
        const mintsObj = mintsToTransfer.map(x => new MintTransfer(distro.wallet.trim(), x));
        mintsTransferList = _.concat(mintsTransferList, mintsObj);
    }
    const progressBar = getProgressBar();
    progressBar.start(mintsTransferList.length, 0);

    mintsTransferList = filterMarketPlaces(mintsTransferList);
    console.log(mintsTransferList);
    if (simulate) {
        return mintsTransferList;
    }
    const mintTransferChunks = chunkItems(mintsTransferList, batchSize);
    for (let mintTransferChunk of mintTransferChunks) {
        await Promise.all(mintTransferChunk.map(async (mint, index) => {
            let start = now();
            try {
                const ownerAta = await getAssociatedTokenAddress(new PublicKey(mint.mintId), new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
                await tryTransferMint(mint, connection, keypair, 1, ownerAta, fromWallet);
            }
            catch (err: any) {
                const message = `ERROR: Failed to send NFT ${mint.mintId} to ${mint.wallet}.`;
                let errorMsg: TransferError = {
                    wallet: mint.wallet,
                    mint: mint.mintId,
                    transferAmount: 1,
                    message: message,
                    error: err.message,
                    isNFT: true,
                };
                log.error(chalk.red(message));
                fs.appendFileSync(LogFiles.TransferNftErrorsTxt, message);
                const errorString = fs.readFileSync(LogFiles.TransferErrorJson, 'utf-8');
                if (errorString) {
                    const jsonErrors = JSON.parse(errorString) as TransferError[];
                    jsonErrors.push(errorMsg);
                    const writeJson = JSON.stringify(jsonErrors);
                    fs.writeFileSync(LogFiles.TransferErrorJson, writeJson);

                }
                else {
                    let newError = [errorMsg];
                    const writeJson = JSON.stringify(newError);
                    fs.writeFileSync(LogFiles.TransferErrorJson, writeJson);
                }
            }
            finally {
                progressBar.increment();
                elapsed(start, true);
            }
        }));
    }
    progressBar.stop();
    Promise.resolve();
}


export async function retryErrors(keypair: Keypair, errorJsonFilePath: string, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false, batchSize: number = 5): Promise<any> {
    let jsonData: any = {};
    const data = fs.readFileSync(errorJsonFilePath, "utf8");
    jsonData = JSON.parse(data);
    const connection = getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    const distributionList = jsonData as TransferError[];

    //mintsTransferList = filterMarketPlaces(mintsTransferList);
    if (simulate) {
        return distributionList;
    }
    const progressBar = getProgressBar();
    progressBar.start(distributionList.length, 0);
    const retryErrorsChunk = chunkItems(distributionList, batchSize);
    for (let retrtyErrorChunk of retryErrorsChunk) {
        await Promise.all(retrtyErrorChunk.map(async (retryError, index) => {
            let start = now();
            try {
                const ownerAta = await getAssociatedTokenAddress(new PublicKey(retryError.mint), new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
                const walletAta = await promiseRetry(() => getOrCreateAssociatedTokenAccount(connection, keypair, new PublicKey(retryError.mint), new PublicKey(retryError.wallet), false, 'confirmed', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
                if (walletAta.amount < retryError.transferAmount) {
                    await tryTransferError(retryError, connection, keypair, ownerAta, fromWallet, retryError.isNFT);
                }
                else {
                    log.warn(chalk.yellow(`${retryError.wallet} already has token ${retryError.mint}`));
                }

            }
            catch (err: any) {
                const message = `ERROR: Failed AGAIN to send ${retryError.mint} to ${retryError.wallet}.`;
                let errorMsg: TransferError = {
                    wallet: retryError.wallet,
                    mint: retryError.mint,
                    transferAmount: retryError.transferAmount,
                    message: message,
                    error: err.message
                };
                log.error(chalk.red(message));
                fs.appendFileSync(LogFiles.RetryTransferErrorTxt, message);
                if (!fs.existsSync(LogFiles.RetryTransferErrorJson)) {
                    fs.writeFileSync(LogFiles.RetryTransferErrorJson, JSON.stringify([]));
                }
                const errorString = fs.readFileSync(LogFiles.RetryTransferErrorJson, 'utf-8');
                if (errorString) {
                    const jsonErrors = JSON.parse(errorString) as TransferError[];
                    jsonErrors.push(errorMsg);
                    const writeJson = JSON.stringify(jsonErrors);
                    fs.writeFileSync(LogFiles.RetryTransferErrorJson, writeJson);

                }
                else {
                    let newError = [errorMsg];
                    const writeJson = JSON.stringify(newError);
                    fs.writeFileSync(LogFiles.RetryTransferErrorJson, writeJson);
                }
            }
            finally {
                progressBar.increment();
                elapsed(start, true, log);
            }
        }));

    }
    progressBar.stop();
    Promise.resolve();
}

export function formatNftDrop(holderAccounts: HolderAccount[], amountPerMint: number) : Distribution[] {
    let mintTfer: Distribution[] = [];
    for (var wallet of holderAccounts) {
        const holderAcct: Distribution = {
            wallet: wallet.walletId,
            totalOwnedNftsCount: wallet.totalAmount,
            nFtsToAirdrop: wallet.totalAmount * amountPerMint
        }
        mintTfer.push(holderAcct);
    }
    return mintTfer;
}

export async function getTransferTransactionInfo(transactionHashes: string[], cluster: string = "devnet", rpcUrl: string | null = null) : Promise<string[]> {
    let accountsToExclude: any[] = [];
    const connection = getConnection(cluster, rpcUrl);
    log.info(`Fetching ${transactionHashes.length} txns...`);
    const parsedTransactions = await connection.getParsedTransactions(transactionHashes);
    log.info(`Fetched ${transactionHashes.length} txns... parsing...`);
    const progressBar = getProgressBar();
    progressBar.start(parsedTransactions.length, 0);
    for(const txn of parsedTransactions) {
        const account = txn?.transaction.message.accountKeys.filter(x => !x.signer && x.pubkey.toBase58() !== "7YQ9zmi4Vt1QVSGji9TjP5yjTA6Aaaro8NAtxRT34UHK");
        const accountTransfered = account ? account[0]: undefined
        
        if(accountTransfered) {
            const accountInfo = await connection.getParsedAccountInfo(accountTransfered.pubkey);
            const parsed = (accountInfo?.value?.data as ParsedAccountData)?.parsed as ParsedAccountDataType;
            if(parsed) {
                accountsToExclude.push(parsed.info.owner);
            }   
            else{
                log.warn('Couldnt parse account info \n', accountTransfered.pubkey.toBase58());
                
                

            }
            progressBar.increment();
        }
    }
    progressBar.stop();
    return accountsToExclude;
}



export function formatNftDropByWallet(holderAccounts: string[], amountPerMint: number) : Distribution[] {
    let mintTfer: Distribution[] = [];
    for (var wallet of holderAccounts) {
        const holderAcct: Distribution = {
            wallet: wallet,
            totalOwnedNftsCount: 1,
            nFtsToAirdrop: amountPerMint
        }
        mintTfer.push(holderAcct);
    }
    return mintTfer;
}

export function formatHoldersList(snapShotFilePath: string) : HolderAccount[] {
    const stringData = fs.readFileSync(snapShotFilePath, 'utf-8');
    const jsonData = JSON.parse(stringData) as any;
    let holders: HolderAccount[] = [];
    for (var wallet in jsonData) {
        const holderAcct: HolderAccount = {
            walletId: wallet,
            totalAmount: jsonData[wallet].amount,
            mintIds: jsonData[wallet].mints
        }
        holders.push(holderAcct);
    }
    return holders;
}

export function formatWalletList(snapShotFilePath: string) : string[] {
    const stringData = fs.readFileSync(snapShotFilePath, 'utf-8');
    const jsonData = JSON.parse(stringData) as any;
    let wallets: string[] = [];
    for (var wallet in jsonData) {
        wallets.push(wallet);
    }
    return wallets;
}

async function tryTransfer(toWallet: HolderAccount, tokenMint: PublicKey, connection: Connection, keypair: Keypair, totalTransferAmt: number, ownerAta: PublicKey, fromWallet: PublicKey): Promise<any> {

    const transfer = await prepTransfer(new PublicKey(toWallet.walletId), tokenMint, totalTransferAmt, connection, keypair, ownerAta, fromWallet, false);
    const signature = await connection.sendTransaction(transfer.txn, [keypair], { skipPreflight: true, maxRetries: 100 });
    await connection.confirmTransaction(signature, 'finalized');
    let message = `Sent ${totalTransferAmt} of ${tokenMint.toBase58()} to ${transfer.destination.toBase58()}. Signature ${signature}. \n`;
    log.info(chalk.green('Sent ') + chalk.yellow(`${totalTransferAmt}`) + chalk.green(`of ${tokenMint.toBase58()} to ${transfer.destination.toBase58()} `) + chalk.blue(`Signature ${signature}. \n`));
    fs.appendFileSync(LogFiles.TokenTransferTxt, message);

}

async function tryTransferError(toWallet: TransferError, connection: Connection, keypair: Keypair, ownerAta: PublicKey, fromWallet: PublicKey, closeAccounts?: boolean): Promise<any> {
    const transfer = await prepTransfer(new PublicKey(toWallet.wallet), new PublicKey(toWallet.mint), toWallet.transferAmount, connection, keypair, ownerAta, fromWallet, closeAccounts);
    const signature = await connection.sendTransaction(transfer.txn, [keypair], { skipPreflight: true, maxRetries: 100 });
    await connection.confirmTransaction(signature, 'finalized');
    let message = `Sent ${toWallet.transferAmount} of ${transfer.mint.toBase58()} to ${transfer.destination.toBase58()}. Signature ${signature}. \n`;
    log.info(chalk.green('Sent ') + chalk.yellow(`${toWallet.transferAmount}`) + chalk.green(` of ${transfer.mint.toBase58()} to ${transfer.destination.toBase58()} `) + chalk.blue(`Signature ${signature}. \n`));
    fs.appendFileSync(LogFiles.RetryTransferTxt, message);
    return signature;
}

async function tryTransferMint(toWallet: MintTransfer, connection: Connection, keypair: Keypair, totalTransferAmt: number, ownerAta: PublicKey, fromWallet: PublicKey): Promise<any> {
    const transfer = await prepTransfer(new PublicKey(toWallet.wallet), new PublicKey(toWallet.mintId), totalTransferAmt, connection, keypair, ownerAta, fromWallet, true);
    const signature = await connection.sendTransaction(transfer.txn, [keypair], { skipPreflight: true, maxRetries: 100 });
    await connection.confirmTransaction(signature, 'finalized');
    let message = `Sent ${totalTransferAmt} of ${transfer.mint.toBase58()} to ${transfer.destination}. Signature ${signature}. \n`;
    log.info(chalk.green('Sent ') + chalk.yellow(` ${totalTransferAmt} `) + chalk.green(` of ${transfer.mint.toBase58()} to ${transfer.destination.toBase58()} `) + chalk.blue(` Signature ${signature}. \n `));
    fs.appendFileSync(LogFiles.TransferNftTxt, message);
    return signature;
}

async function prepTransfer(toWallet: PublicKey, mint: PublicKey, totalTransferAmt: number, connection: Connection, keypair: Keypair, ownerAta: PublicKey, fromWallet: PublicKey, createCloseIx: boolean = false): Promise<Transfer> {

    const toWalletPk = new PublicKey(toWallet);
    const mintPk = new PublicKey(mint);
    const walletAta = await promiseRetry(() => getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'finalized', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
    const txnIns = createTransferInstruction(ownerAta, walletAta.address, fromWallet, totalTransferAmt, [keypair], TOKEN_PROGRAM_ID);
    const txn = new Transaction().add(txnIns);
    if (createCloseIx) {
        const closeAccount = createCloseAccountInstruction(ownerAta, keypair.publicKey, keypair.publicKey, undefined, TOKEN_PROGRAM_ID);
        txn.add(closeAccount);
    }
    return {
        txn: txn,
        mint: mintPk,
        destination: toWalletPk
    }
}

export async function findMintersAtPrice(price: number) { 
    
}


async function getTransaction(mint: PublicKey, connection: Connection){
    connection.getSignaturesForAddress(mint, {})
}

function filterMarketPlaces(transfers: MintTransfer[]): MintTransfer[] {
    return transfers.filter(x => isNotMarketPlace(x.wallet));
}

function filterMarketPlacesByHolders(transfers: HolderAccount[]): HolderAccount[] {
    let arr =  _.filter(transfers, x => isNotMarketPlace(x.walletId));
    return arr;
}

function filterMarketPlacesByWallet(wallets: string[]): string[] {
    return wallets.filter(x => isNotMarketPlace(x));
}

function isNotMarketPlace(walletId: string): boolean {
    const mktplaces = [
        MarketPlaces.MagicEden,
        MarketPlaces.AlphaArt,
        MarketPlaces.DigitalEyes,
        MarketPlaces.ExchangeArt,
        MarketPlaces.Solanart
    ]
    return !mktplaces.includes(walletId);
}

function getProgressBar() : cliProgress.SingleBar {
    return new cliProgress.SingleBar(
        {
            format: 'Progress: [{bar}] {percentage}% | {value}/{total} ',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
        },
        cliProgress.Presets.shades_classic,
    );
}

function getLamports(decimal: number): number {
    if (decimal == 9) {
        return LAMPORTS_PER_SOL;
    }
    else if (decimal == 0) {
        return 1;
    }
    else {
        let amount = 0;
        switch (decimal) {
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