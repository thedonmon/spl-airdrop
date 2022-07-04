import { HolderAccount } from '../types/holderaccounts';
import { RpcResponse } from '../types/rpcresponse';
import { RpcRequest } from '../types/rpcrequest';
import axios from 'axios';
import { Cluster, clusterApiUrl, Connection, Keypair, ParsedAccountData } from '@solana/web3.js';
import * as fs from 'fs';
import log from 'loglevel';
import { sendAndConfirmWithRetry } from './transaction-helper';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';


export class TimeoutError extends Error {
    message: string;
    txid: string;
    timeout: boolean = true;
    constructor(txid: string) {
        super();
        this.message = `Timed out awaiting confirmation. Please confirm in the explorer: `;
        this.txid = txid;
    }
}

export function sleep(ms: number): Promise<any> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function promiseRetry<T>(fn: () => Promise<T>, retries = 5, err?: any): Promise<T> {
    if (err) {
        if (err?.name && err.name === 'TokenOwnerOffCurveError') {
            console.log('Will not retry. Address is a PDA. Specify allow off curve if this is intended');
            return Promise.reject(new Error('TokenOwnerOffCurveError.  Specify allow off curve if this is intended'));
        }
        console.log('retrying ', retries);
        console.log(err);
    }
    await new Promise(resolve => setTimeout(resolve, (5 - retries) * 1000));

    return !retries ? Promise.reject(err) : fn().catch(error => promiseRetry(fn, (retries - 1), error));
}

export async function timeout(ms: number, retryCount?: number, log?: boolean): Promise<any> {
    if (log) {
        console.log('Waiting for next retry', retryCount);
    }
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const chunkItems = <T>(items: T[], chunkSize?: number) =>
    items.reduce((chunks: T[][], item: T, index) => {
        const chunkSz = chunkSize ?? 50;
        const chunk = Math.floor(index / chunkSz);
        chunks[chunk] = ([] as T[]).concat(chunks[chunk] || [], item);
        return chunks;
    }, []);

export async function getSnapshot(mintIds: string[], rpcUrl: string | null = null, cluster: string = 'devnet'): Promise<HolderAccount[]> {
    let accounts: HolderAccount[] = [];
    const connection = getConnection(cluster, rpcUrl);
    const mintIdChunks = chunkItems(mintIds);
    for (const chunk of mintIdChunks)
        await Promise.all(
            chunk.map(async (item) => {
                let filter = {
                    memcmp: {
                        offset: 0,
                        bytes: item,
                    },
                };
                let filter2 = {
                    dataSize: 165,
                };
                let getFilter = [filter, filter2];
                let programAccountsConfig = { filters: getFilter, encoding: "jsonParsed" };
                let tokenResult = await connection.getParsedProgramAccounts(
                    TOKEN_PROGRAM_ID,
                    programAccountsConfig
                );
                if (tokenResult && tokenResult.length > 0) {
                    let mainAccount = tokenResult.filter(x => (x.account.data as ParsedAccountData).parsed.info.tokenAmount.uiAmount > 0)[0];
                    if (mainAccount) {
                        let holder: HolderAccount = {
                            walletId: (mainAccount.account.data as ParsedAccountData).parsed.info.owner,
                            totalAmount: (mainAccount.account.data as ParsedAccountData).parsed.info.tokenAmount.uiAmount,
                            mintIds: [item]
                        };
                        let tryFindAccount = accounts.find(x => x.walletId == holder.walletId);
                        if (tryFindAccount) {
                            console.log('account found, updating holder info', holder.walletId, holder.totalAmount, tryFindAccount.totalAmount);
                            const acctIndex = accounts.findIndex(x => x.walletId == holder.walletId);
                            let newHolder = tryFindAccount;
                            newHolder.mintIds.push(item);
                            newHolder.totalAmount = newHolder.totalAmount + holder.totalAmount;
                            accounts[acctIndex] = newHolder;
                        }
                        else {
                            console.log('account not found yet, adding to overall holders', holder.walletId);
                            accounts.push(holder);
                        }
                    }

                }
            })
        );
    return accounts;
}

export function loadWalletKey(keypair: string): Keypair {
    if (!keypair || keypair == '') {
        throw new Error('Keypair is required!');
    }
    const loaded = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(fs.readFileSync(keypair).toString())),
    );
    log.info(`wallet public key: ${loaded.publicKey}`);
    return loaded;
}

export function getConnection(cluster: string, rpcUrl: string | null): Connection {
    const connection = rpcUrl != null ? new Connection(rpcUrl, { confirmTransactionInitialTimeout: 120000, commitment: 'confirmed' }) : new Connection(clusterApiUrl(cluster as Cluster), { confirmTransactionInitialTimeout: 120000, commitment: 'confirmed' });
    return connection;
}

export async function sendRawTransactionWithRetry(connection: Connection, txn: Buffer): Promise<string> {
    const result = await sendAndConfirmWithRetry(connection, txn, { skipPreflight: true, maxRetries: 0 }, 'finalized', 120000);
    return result.txid;
}

export function now(eventName = null) {
    if (eventName) {
        console.log(`Started ${eventName}..`);
    }
    return new Date().getTime();
}

// Returns time elapsed since `beginning`
// (and, optionally, prints the duration in seconds)
export function elapsed(beginning: number, log = false, logger?: any) {
    const duration = new Date().getTime() - beginning;
    if (log) {
        if (logger) {
            logger.info(` ${duration / 1000}s `);
        }
        else {
            console.log(` ${duration / 1000}s `);
        }
    }
    return duration;
}