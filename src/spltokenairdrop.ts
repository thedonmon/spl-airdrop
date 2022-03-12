import * as spl from '@solana/spl-token';
import * as cliProgress from 'cli-progress';
import log from 'loglevel';
import chalk from 'chalk';
import { clusterApiUrl, PublicKey, Transaction, Keypair, Connection, Cluster } from '@solana/web3.js';
import * as fs from 'fs';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, transfer } from '@solana/spl-token';
import { chunkItems, getConnection, promiseRetry } from './helpers/utility';
import { MintTransfer } from './types/mintTransfer';
import { MarketPlaces } from './helpers/constants';
import { HolderAccount } from './types/holderaccounts';

export async function airdropToken(keypair: Keypair, whitelistPath: string, transferAmount: number, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false): Promise<any> {
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
    const walletChunks = chunkItems(addresses, 5);
    const stream = fs.createWriteStream("tokentransfers.txt", { flags: 'a' });
    const failStream = fs.createWriteStream("tokentransfersnft-errors.txt", { flags: 'a' });

    for (let walletChunk of walletChunks) {
        walletChunk.map(async (toWallet, index) => {
            try {
                progressBar.increment();
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
                    log.info(chalk.green(message));
                    stream.write(message);
                }
            }
            catch (err) {
                const message = `ERROR: Sending ${transferAmount} of ${mint} to ${toWallet} failed. \n`;
                log.error(chalk.red(message));
                const json = JSON.stringify({ tokenTransferAmount: transferAmount, holder: toWallet });
                failStream.write(json);
                console.error(err, message);
            }
        });
    }
    stream.close();
    failStream.close();
}

export async function airdropTokenPerNft(keypair: Keypair, holdersList: HolderAccount[], tokenMint: PublicKey, transferAmount: number, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false): Promise<any> {
    var connection = getConnection(cluster, rpcUrl);
    const fromWallet = keypair.publicKey;
    let holders = holdersList;
    holders = filterMarketPlacesByHolders(holdersList);
    if (simulate) {
        return holders.map(x => ({ wallet: x, transferAmt: (transferAmount * x.mintIds.length) }));
    }

    const progressBar = new cliProgress.SingleBar(
        {
            format: 'Progress: [{bar}] {percentage}% | {value}/{total}',
        },
        cliProgress.Presets.shades_classic,
    );

    progressBar.start(holdersList.length, 0);
    const ownerAta = await spl.getAssociatedTokenAddress(tokenMint, new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const walletChunks = chunkItems(holdersList, 5);
    const stream = fs.createWriteStream("tokentransfersnft.txt", { flags: 'a' });
    const failStream = fs.createWriteStream("tokentransfersnft-errors.txt", { flags: 'a' });

    for (let walletChunk of walletChunks) {
        walletChunk.map(async (toWallet, index) => {
            progressBar.increment();
            const totalTransferAmt = transferAmount * toWallet.mintIds.length;
            try {
                const toWalletPk = new PublicKey(toWallet.walletId);
                const mintPk = tokenMint;;
                const walletAta = await promiseRetry(() => spl.getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'finalized', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
                console.log(toWallet, walletAta.amount, index);
                if (walletAta.amount < transferAmount) {
                    const txnIns = spl.createTransferInstruction(ownerAta, walletAta.address, fromWallet, totalTransferAmt, [keypair], TOKEN_PROGRAM_ID);
                    const txn = new Transaction().add(txnIns);
                    const signature = await connection.sendTransaction(txn, [keypair], { skipPreflight: true, maxRetries: 50 });
                    await connection.confirmTransaction(signature, 'finalized');
                    let message = `Sent ${transferAmount} of ${tokenMint.toBase58()} to ${toWallet}. Signature ${signature}. \n`;
                    log.info(chalk.green(message));
                    stream.write(message);
                }
            }
            catch (err) {
                const message = `ERROR: Sending ${transferAmount} of ${tokenMint.toBase58()} to ${toWallet} failed. \n`;
                const json = JSON.stringify({ tokenTransferAmoint: totalTransferAmt, holder: toWallet });
                log.error(chalk.red(message));
                failStream.write(json);
                console.error(err, message);
            }
        });
    }
    stream.close();
    failStream.close();
}


export async function airdropNft(keypair: Keypair, whitelistPath: string, mintlistPath: string, cluster: string = "devnet", rpcUrl: string | null = null, simulate: boolean = false): Promise<any> {
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
    const failStream = fs.createWriteStream("nfttransfer-errors.txt", { flags: 'a' });

    let mintsTransferList: MintTransfer[] = [];
    for (let distro of distributionList) {
        const mintsToTransfer = mintListArr.splice(0, distro.nFtsToAirdrop);
        const mintsObj = mintsToTransfer.map(x => new MintTransfer(distro.wallet, x));
        mintsTransferList.concat(mintsObj);
    }
    mintsTransferList = filterMarketPlaces(mintsTransferList);
    if (simulate) {
        stream.close();
        failStream.close();
        return mintsTransferList;
    }
    const mintTransferChunks = chunkItems(mintsTransferList, 5);
    for (let mintTransferChunk of mintTransferChunks) {
        mintTransferChunk.map(async (mint, index) => {
            try {
                progressBar.increment();
                const ownerAta = await spl.getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(fromWallet), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
                const toWalletPk = new PublicKey(mint.mintId);
                const mintPk = new PublicKey(mint);
                const walletAta = await promiseRetry(() => spl.getOrCreateAssociatedTokenAccount(connection, keypair, mintPk, toWalletPk, false, 'finalized', { skipPreflight: true, maxRetries: 100 }, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
                const txnIns = spl.createTransferInstruction(ownerAta, walletAta.address, fromWallet, 1, [keypair], TOKEN_PROGRAM_ID);
                const txn = new Transaction().add(txnIns);
                const signature = await connection.sendTransaction(txn, [keypair], { skipPreflight: true, maxRetries: 50 });
                await connection.confirmTransaction(signature, 'finalized');
                let message = `Sent NFT ${mint.mintId} to ${mint.wallet}. Signature ${signature}. \n`;
                log.info(chalk.green(message));
                stream.write(message);
            }
            catch (err: any) {
                const message = `ERROR: Failed to send NFT ${mint.mintId} to ${mint.wallet}. \n`;
                log.error(chalk.red(message));
                const json = JSON.stringify(mint);
                console.error(err, message);
                failStream.write(json);
            }
        });

    }
    stream.close();
    failStream.close();
}

function filterMarketPlaces(transfers: MintTransfer[]): MintTransfer[] {
    return transfers.filter(x => (x.wallet !== MarketPlaces.MagicEden && x.wallet !== MarketPlaces.AlphaArt && x.wallet !== MarketPlaces.DigitalEyes && x.wallet !== MarketPlaces.ExchangeArt && x.wallet !== MarketPlaces.Solanart));
}

function filterMarketPlacesByHolders(transfers: HolderAccount[]): HolderAccount[] {
    return transfers.filter(x => (x.walletId !== MarketPlaces.MagicEden && x.walletId !== MarketPlaces.AlphaArt && x.walletId !== MarketPlaces.DigitalEyes && x.walletId !== MarketPlaces.ExchangeArt && x.walletId !== MarketPlaces.Solanart));
}

function filterMarketPlacesByWallet(wallets: string[]): string[] {
    return wallets.filter(x => (x !== MarketPlaces.MagicEden && x !== MarketPlaces.AlphaArt && x !== MarketPlaces.DigitalEyes && x !== MarketPlaces.ExchangeArt && x !== MarketPlaces.Solanart));
}