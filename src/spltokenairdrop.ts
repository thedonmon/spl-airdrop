import * as splToken from '@solana/spl-token';
import * as cliProgress from 'cli-progress';
import _ from 'lodash';
import log from 'loglevel';
import chalk from 'chalk';
import * as web3Js from '@solana/web3.js';
import * as fs from 'fs';
import * as utility from './helpers/utility';
import { MintTransfer } from './types/mintTransfer';
import { AirdropCliRequest, AirdropTypeRequest } from './types/cli';
import { LogFiles, MarketPlaces } from './helpers/constants';
import { HolderAccount } from './types/holderaccounts';
import { TransferError } from './types/errorTransfer';
import { Transfer } from './types/transfer';
import { Distribution } from './types/distribution';
import { ParsedAccountDataType } from './types/accountType';
import { TransactionInfoOptions } from './types/txnOptions';
import { sendAndConfirmWithRetry } from './helpers/transaction-helper';
import { ITransferRequest, TransferErrorRequest, TransferMintRequest } from './types/transferRequest';

export async function airdropToken(request: AirdropCliRequest): Promise<any> {
    const { keypair, whitelistPath, transferAmount, cluster = "devnet", rpcUrl = null, simulate = false, batchSize = 250, exclusionList = [], mintIfAuthority = true, overrideBalanceCheck = false } = request;
    let jsonData: any = {};
    const data = fs.readFileSync(whitelistPath!, "utf8");
    jsonData = JSON.parse(data);
    var connection = utility.getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    const mint = jsonData.mint as string;
    let addresses = jsonData.wallets as string[];
    addresses = filterMarketPlacesByWallet(addresses);
    if (exclusionList.length > 0) {
        addresses = addresses.filter(item => !exclusionList.includes(item));
    }
    if (simulate) {
        return addresses.map(x => ({ wallet: x, transferAmt: transferAmount }));
    }
    const mintPk = new web3Js.PublicKey(mint);
    const mintObj = await splToken.getMint(connection, mintPk, 'confirmed', splToken.TOKEN_PROGRAM_ID);
    const amountToTransfer = utility.getLamports(mintObj.decimals) * transferAmount!;
    const progressBar = getProgressBar();
    progressBar.start(addresses.length, 0);
    const ownerAta = await splToken.getAssociatedTokenAddress(mintPk, new web3Js.PublicKey(fromWallet), false, splToken.TOKEN_PROGRAM_ID, splToken.ASSOCIATED_TOKEN_PROGRAM_ID)
    const walletChunks = utility.chunkItems(addresses, batchSize);
    overrideBalanceCheck ? log.warn(`Overriding balance check. Sending amount ${amountToTransfer}`) : null;
    for (let walletChunk of walletChunks) {
        await Promise.all(walletChunk.map(async (toWallet, index) => {
            let start = utility.now();
            try {
                const toWalletPk = new web3Js.PublicKey(toWallet);
                const walletAta = await utility.promiseRetry(() => splToken.getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'confirmed', { skipPreflight: true, maxRetries: 100 }, splToken.TOKEN_PROGRAM_ID, splToken.ASSOCIATED_TOKEN_PROGRAM_ID));
                if (walletAta.amount < amountToTransfer || overrideBalanceCheck) {
                    await tryMintTo({ mintObj, walletAta, tokenMint: mintPk, connection, keypair, totalTransferAmt: amountToTransfer, ownerAta, fromWallet, toWallet: toWalletPk, mintIfAuthority });
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
                    transferAmount: transferAmount!,
                    message: message,
                    error: err.message
                };
                handleError(errorMsg, LogFiles.TransferErrorJson, LogFiles.TokenTransferErrorsTxt);
            }
            finally {
                progressBar.increment();
                utility.elapsed(start, true, log);
            }
        }));
    }
    progressBar.stop();
    return Promise.resolve();
}

export async function airdropTokenPerNft(request: AirdropTypeRequest<HolderAccount>): Promise<any> {
    const { keypair, holdersList, tokenMint, decimals, transferAmount, cluster = "devnet", rpcUrl = null, simulate = false, batchSize = 50, exclusionList = [] } = request;
    var connection = utility.getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    let holders: HolderAccount[] = filterMarketPlacesByHolders(holdersList!);
    let decimalsToUse = utility.getLamports(decimals!);
    console.log(holders.length, holdersList!.length);
    if (exclusionList.length > 0) {
        holders = holders.filter(item => !exclusionList.includes(item.walletId));
    }
    if (simulate) {
        return holders.map(x => { return { wallet: x.walletId, transferAmt: (transferAmount! * x.totalAmount * decimalsToUse) } });
    }

    const progressBar = getProgressBar();
    const ownerAta = await splToken.getAssociatedTokenAddress(tokenMint!, new web3Js.PublicKey(fromWallet), false, splToken.TOKEN_PROGRAM_ID, splToken.ASSOCIATED_TOKEN_PROGRAM_ID)
    const walletChunks = utility.chunkItems(holders, batchSize);
    progressBar.start(holders.length, 0);

    for (let walletChunk of walletChunks) {
        await Promise.all(walletChunk.map(async (toWallet, index) => {
            let start = utility.now();
            const totalTransferAmt = transferAmount! * toWallet.totalAmount * decimalsToUse;
            try {
                await tryTransfer({ toWallet, tokenMint, connection, keypair, totalTransferAmt, ownerAta, fromWallet });
            }
            catch (err: any) {
                const message = `ERROR: Sending ${totalTransferAmt} of ${tokenMint!.toBase58()} to ${toWallet.walletId} failed. \n`;
                let errorMsg: TransferError = {
                    wallet: toWallet.walletId,
                    mint: tokenMint!.toBase58(),
                    holdings: toWallet.totalAmount,
                    transferAmount: totalTransferAmt,
                    message: message,
                    error: err.message
                };
                handleError(errorMsg, LogFiles.TransferErrorJson, LogFiles.TokenTransferNftTxt);
            }
            finally {
                progressBar.increment();
                utility.elapsed(start, true, log);
            }
        }));
    }
    progressBar.stop();
    Promise.resolve();
}


export async function airdropNft(request: AirdropCliRequest): Promise<any> {
    const { keypair, whitelistPath, mintlistPath, cluster = "devnet", rpcUrl = null, simulate = false, batchSize = 50 } = request;
    let jsonData: any = {};
    const data = fs.readFileSync(whitelistPath!, "utf8");
    const mintlist = fs.readFileSync(mintlistPath!, "utf8");
    jsonData = JSON.parse(data);
    const mintListArr = JSON.parse(mintlist) as string[];
    const connection = utility.getConnection(cluster, rpcUrl);
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
    const mintTransferChunks = utility.chunkItems(mintsTransferList, batchSize);
    for (let mintTransferChunk of mintTransferChunks) {
        await Promise.all(mintTransferChunk.map(async (mint, index) => {
            let start = utility.now();
            try {
                const ownerAta = await splToken.getAssociatedTokenAddress(new web3Js.PublicKey(mint.mintId), new web3Js.PublicKey(fromWallet), false, splToken.TOKEN_PROGRAM_ID, splToken.ASSOCIATED_TOKEN_PROGRAM_ID);
                await tryTransferMint({ toWallet: mint, connection, keypair, totalTransferAmt: 1, ownerAta, fromWallet });
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
                handleError(errorMsg, LogFiles.TransferErrorJson, LogFiles.TransferNftErrorsTxt);
            }
            finally {
                progressBar.increment();
            }
        }));
    }
    progressBar.stop();
    Promise.resolve();
}


function handleError(errorMsg: TransferError, transferErrorJsonPath: string, transferErrorTxtPath: string): void {
    log.error(chalk.red(errorMsg.message));
    fs.appendFileSync(LogFiles.TransferNftErrorsTxt, errorMsg.message!);
    if (!fs.existsSync(transferErrorJsonPath)) {
        fs.writeFileSync(transferErrorJsonPath, JSON.stringify([]));
    }
    const errorString = fs.readFileSync(transferErrorTxtPath, 'utf-8');
    if (errorString) {
        const jsonErrors = JSON.parse(errorString) as TransferError[];
        jsonErrors.push(errorMsg);
        const writeJson = JSON.stringify(jsonErrors);
        fs.writeFileSync(transferErrorJsonPath, writeJson);

    }
    else {
        let newError = [errorMsg];
        const writeJson = JSON.stringify(newError);
        fs.writeFileSync(transferErrorJsonPath, writeJson);
    }
}

export async function retryErrors(keypair: web3Js.Keypair, errorJsonFilePath: string, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false, batchSize: number = 5): Promise<any> {
    let jsonData: any = {};
    const data = fs.readFileSync(errorJsonFilePath, "utf8");
    jsonData = JSON.parse(data);
    const connection = utility.getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    const distributionList = jsonData as TransferError[];

    //mintsTransferList = filterMarketPlaces(mintsTransferList);
    if (simulate) {
        return distributionList;
    }
    const progressBar = getProgressBar();
    progressBar.start(distributionList.length, 0);
    const retryErrorsChunk = utility.chunkItems(distributionList, batchSize);
    for (let retrtyErrorChunk of retryErrorsChunk) {
        await Promise.all(retrtyErrorChunk.map(async (retryError, index) => {
            let start = utility.now();
            try {
                const ownerAta = await splToken.getAssociatedTokenAddress(new web3Js.PublicKey(retryError.mint), new web3Js.PublicKey(fromWallet), false, splToken.TOKEN_PROGRAM_ID, splToken.ASSOCIATED_TOKEN_PROGRAM_ID);
                const walletAta = await utility.promiseRetry(() => splToken.getOrCreateAssociatedTokenAccount(connection, keypair, new web3Js.PublicKey(retryError.mint), new web3Js.PublicKey(retryError.wallet), false, 'confirmed', { skipPreflight: true, maxRetries: 100 }, splToken.TOKEN_PROGRAM_ID, splToken.ASSOCIATED_TOKEN_PROGRAM_ID));
                if (walletAta.amount < retryError.transferAmount) {
                    await tryTransferError({ toWallet: retryError, connection, keypair, ownerAta, fromWallet, closeAccounts: retryError.isNFT });
                }
                else {
                    log.warn(chalk.yellow(`${retryError.wallet} already has token ${retryError.mint}`));
                }
                utility.elapsed(start, true, log);
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
                handleError(errorMsg, LogFiles.RetryTransferErrorJson, LogFiles.RetryTransferErrorTxt);
            }
            finally {
                progressBar.increment();
            }
        }));

    }
    progressBar.stop();
    Promise.resolve();
}

export function formatNftDrop(holderAccounts: HolderAccount[], amountPerMint: number): Distribution[] {
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

export async function getTransferTransactionInfo(transactionHashes: string[], cluster: string = "devnet", rpcUrl: string | null = null, txnOptions?: TransactionInfoOptions): Promise<any[]> {
    let accountsToExclude: any[] = [];
    const connection = utility.getConnection(cluster, rpcUrl);
    log.info(`Fetching ${transactionHashes.length} txns...`);
    const parsedTransactions = await connection.getParsedTransactions(transactionHashes);
    log.info(`Fetched ${transactionHashes.length} txns... parsing...`);
    const progressBar = getProgressBar();
    progressBar.start(parsedTransactions.length, 0);
    for (const txn of parsedTransactions) {
        const account = txnOptions ? (txnOptions.excludeAddress && txnOptions.excludeSigner ? txn?.transaction.message.accountKeys.filter(x => !x.signer && x.pubkey.toBase58() !== txnOptions.excludeAddress) : txn?.transaction.message.accountKeys) : txn?.transaction.message.accountKeys;
        const accountTransfered = account ? account[0] : undefined

        if (accountTransfered) {
            const accountInfo = await connection.getParsedAccountInfo(accountTransfered.pubkey);
            const parsed = (accountInfo?.value?.data as web3Js.ParsedAccountData)?.parsed as ParsedAccountDataType;
            if (parsed) {
                if (txnOptions && txnOptions.getInfo) {
                    accountsToExclude.push(parsed);
                }
                else {
                    accountsToExclude.push(parsed.info.owner);
                }
            }
            else {
                log.warn('Couldnt parse account info \n', accountTransfered.pubkey.toBase58());
            }
            progressBar.increment();
        }
    }
    progressBar.stop();
    return accountsToExclude;
}



export function formatNftDropByWallet(holderAccounts: string[], amountPerMint: number): Distribution[] {
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

export function formatHoldersList(snapShotFilePath: string): HolderAccount[] {
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

export function formatWalletList(snapShotFilePath: string): string[] {
    const stringData = fs.readFileSync(snapShotFilePath, 'utf-8');
    const jsonData = JSON.parse(stringData) as any;
    let wallets: string[] = [];
    for (var wallet in jsonData) {
        wallets.push(wallet);
    }
    return wallets;
}

async function tryMintTo(request: TransferMintRequest<web3Js.PublicKey>): Promise<{ txid: string }> {
    let { mintObj,
        walletAta,
        tokenMint,
        connection,
        keypair,
        totalTransferAmt,
        ownerAta,
        fromWallet,
        toWallet,
        mintIfAuthority = true } = request;
    let txnIx: web3Js.TransactionInstruction;
    if (mintObj.mintAuthority?.toBase58() == keypair.publicKey.toBase58() && mintIfAuthority) {
        txnIx = splToken.createMintToInstruction(mintObj.address, walletAta.address, keypair.publicKey, totalTransferAmt!, undefined, splToken.TOKEN_PROGRAM_ID);
    }
    else {
        txnIx = splToken.createTransferInstruction(ownerAta, walletAta.address, fromWallet, totalTransferAmt!, [keypair], splToken.TOKEN_PROGRAM_ID);
    }
    const txn = new web3Js.Transaction().add(txnIx);
    txn.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    txn.sign(keypair);
    const signature = await sendAndConfrimInternal(connection, txn);
    let message = `${mintIfAuthority ? 'Minted ' : 'Transferred '} ${totalTransferAmt} of ${splicer(tokenMint!.toBase58())} to ${toWallet.toBase58()}. https://solscan.io/tx/${signature.txid}  \n`;
    log.info(chalk.green(`${mintIfAuthority ? 'Minted ' : 'Transferred '}`) + chalk.yellow(`${totalTransferAmt}`) + chalk.green(` of ${splicer(tokenMint!.toBase58())} to ${splicer(toWallet.toBase58())} `) + chalk.blue(` \n https://solscan.io/tx/${signature.txid} \n`));
    fs.appendFileSync(LogFiles.TokenTransferTxt, message);
    return signature;
}

async function tryTransfer(request: ITransferRequest<HolderAccount>): Promise<{ txid: string }> {
    let { toWallet, tokenMint, connection, keypair, totalTransferAmt, ownerAta, fromWallet } = request;
    const transfer = await prepTransfer({ toWallet: new web3Js.PublicKey(toWallet.walletId), tokenMint: tokenMint!, totalTransferAmt: totalTransferAmt!, connection, keypair, ownerAta, fromWallet }, false);
    const signature = await sendAndConfrimInternal(connection, transfer.txn);
    let message = `Sent ${totalTransferAmt} of ${splicer(tokenMint!.toBase58())} to ${transfer.destination.toBase58()}. https://solscan.io/tx/${signature.txid}  \n`;
    log.info(chalk.green('Sent ') + chalk.yellow(`${totalTransferAmt}`) + chalk.green(` of ${splicer(tokenMint!.toBase58())} to ${splicer(transfer.destination.toBase58())} `) + chalk.blue(` \n https://solscan.io/tx/${signature.txid} \n`));
    fs.appendFileSync(LogFiles.TokenTransferTxt, message);
    return signature;
}

async function tryTransferError(request: TransferErrorRequest<TransferError>): Promise<{ txid: string }> {
    let { toWallet, connection, keypair, ownerAta, fromWallet, closeAccounts } = request;
    const transfer = await prepTransfer({ toWallet: new web3Js.PublicKey(toWallet.wallet), tokenMint: new web3Js.PublicKey(toWallet.mint), totalTransferAmt: toWallet.transferAmount, connection, keypair, ownerAta, fromWallet }, closeAccounts);
    const signature = await sendAndConfrimInternal(connection, transfer.txn);
    let message = `Sent ${toWallet.transferAmount} of ${splicer(transfer.mint.toBase58())} to ${transfer.destination.toBase58()} .https://solscan.io/tx/${signature.txid}  \n`;
    log.info(chalk.green('Sent ') + chalk.yellow(`${toWallet.transferAmount}`) + chalk.green(` of ${splicer(transfer.mint.toBase58())} to ${splicer(transfer.destination.toBase58())} `) + chalk.blue(`\n https://solscan.io/tx/${signature.txid} \n`));
    fs.appendFileSync(LogFiles.RetryTransferTxt, message);
    return signature;
}

async function tryTransferMint(request: ITransferRequest<MintTransfer>): Promise<{ txid: string }> {
    let { toWallet, connection, keypair, totalTransferAmt, ownerAta, fromWallet } = request;
    const transfer = await prepTransfer({ toWallet: new web3Js.PublicKey(toWallet.wallet), tokenMint: new web3Js.PublicKey(toWallet.mintId), totalTransferAmt: totalTransferAmt!, connection, keypair, ownerAta, fromWallet }, true);
    const signature = await sendAndConfrimInternal(connection, transfer.txn);
    let message = `Sent ${totalTransferAmt} of ${transfer.mint.toBase58()} to ${transfer.destination}. https://solscan.io/tx/${signature.txid} \n`;
    log.info(chalk.green('Sent ') + chalk.yellow(` ${totalTransferAmt} `) + chalk.green(` of ${splicer(transfer.mint.toBase58())}.. to ${splicer(transfer.destination.toBase58())}.. `) + chalk.blue(`\n https://solscan.io/tx/${signature.txid} \n `));
    fs.appendFileSync(LogFiles.TransferNftTxt, message);
    return signature;
}

async function prepTransfer(request: ITransferRequest<web3Js.PublicKey>, createCloseIx: boolean = false): Promise<Transfer> {
    let { toWallet, tokenMint, totalTransferAmt, connection, keypair, ownerAta, fromWallet } = request;
    const toWalletPk = new web3Js.PublicKey(toWallet);
    const mintPk = tokenMint!;
    const walletAta = await utility.promiseRetry(() => splToken.getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'finalized', { skipPreflight: true, maxRetries: 100 }, splToken.TOKEN_PROGRAM_ID, splToken.ASSOCIATED_TOKEN_PROGRAM_ID));
    const txnIns = splToken.createTransferInstruction(ownerAta, walletAta.address, fromWallet, totalTransferAmt!, [keypair], splToken.TOKEN_PROGRAM_ID);
    const txn = new web3Js.Transaction().add(txnIns);
    if (createCloseIx) {
        const closeAccount = splToken.createCloseAccountInstruction(ownerAta, keypair.publicKey, keypair.publicKey, undefined, splToken.TOKEN_PROGRAM_ID);
        txn.add(closeAccount);
    }
    txn.sign(keypair);
    return {
        txn: txn,
        mint: mintPk,
        destination: toWalletPk
    }
}

async function sendAndConfrimInternal(connection: web3Js.Connection, txn: web3Js.Transaction,
    sendOptions: web3Js.SendOptions = {
        maxRetries: 0,
        skipPreflight: true,
        preflightCommitment: 'confirmed'
    },
    commitment: web3Js.Commitment = 'finalized'): Promise<{ txid: string }> {
    const txnSerialized = txn.serialize();
    const signature = await sendAndConfirmWithRetry(connection, txnSerialized, sendOptions, commitment);
    return signature;
}

function filterMarketPlaces(transfers: MintTransfer[]): MintTransfer[] {
    return transfers.filter(x => isNotMarketPlace(x.wallet));
}

function filterMarketPlacesByHolders(transfers: HolderAccount[]): HolderAccount[] {
    let arr = _.filter(transfers, x => isNotMarketPlace(x.walletId));
    return arr;
}

function filterMarketPlacesByWallet(wallets: string[]): string[] {
    return wallets.filter(x => isNotMarketPlace(x));
}

function isNotMarketPlace(walletId: string): boolean {
    const mktplaces = [
        MarketPlaces.MagicEden,
        MarketPlaces.MagicEden2,
        MarketPlaces.AlphaArt,
        MarketPlaces.DigitalEyes,
        MarketPlaces.ExchangeArt,
        MarketPlaces.Solanart,
    ]
    return !mktplaces.includes(walletId);
}

function getProgressBar(): cliProgress.SingleBar {
    return new cliProgress.SingleBar(
        {
            format: 'Progress: [{bar}] {percentage}% | {value}/{total} ',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
        },
        cliProgress.Presets.shades_classic,
    );
}

function splicer(value: string, charsFirst: number = 4, charsEnd: number = 3) : string {
    const strinLen = value?.length ?? 0;
    let returnStr = '';
    if ((charsFirst || charsEnd) > strinLen) {
        returnStr = strinLen == 0 ? returnStr : `${value.slice(0, strinLen)}`;
    }
    else {
        returnStr = strinLen == 0 ? returnStr : `${value.slice(0, charsFirst)}..${value.slice(-charsEnd)}`;
    }
    return returnStr;
}