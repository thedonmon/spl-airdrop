import { HolderAccount } from '../types/holderaccounts';
import { RpcResponse } from '../types/rpcresponse';
import { RpcRequest } from '../types/rpcrequest';
import axios from 'axios';
import { Cluster, clusterApiUrl, Connection, Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import log from 'loglevel';
import { sendAndConfirmWithRetry } from './transaction-helper';


export function sleep(ms: number): Promise<any> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function promiseRetry<T>(fn: () => Promise<T>, retries = 5, err?: any): Promise<T> {
    console.log('trying transaction');
    if (err) {
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

export async function getSnapshot(mintIds: string[], rpcUrl: string | null = null): Promise<HolderAccount[]> {
    let accounts: HolderAccount[] = [];
    const mintIdChunks = chunkItems(mintIds);
    for (const chunk of mintIdChunks)
        await Promise.all(
            chunk.map(async (item, index) => {
                let request: RpcRequest = {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getProgramAccounts',
                    params: [
                        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                        {
                            encoding: "jsonParsed",
                            filters: [
                                {
                                    dataSize: 165
                                },
                                {
                                    memcmp: {
                                        offset: 0,
                                        bytes: `${item}`
                                    }
                                }
                            ]
                        }
                    ]
                };
                await timeout(500, 0, false);
                let rpc = rpcUrl ?? 'https://pentacle.genesysgo.net/';
                let response = await axios.post<RpcResponse>(rpc, request);
                if (response.status == 200) {
                    const responseData = response.data;
                    let mainAccount = responseData.result.filter(x => x.account.data.parsed.info.tokenAmount.uiAmount > 0)[0];
                    if (mainAccount) {
                        let holder: HolderAccount = {
                            walletId: mainAccount.account.data.parsed.info.owner,
                            totalAmount: mainAccount.account.data.parsed.info.tokenAmount.uiAmount,
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
    const result = await sendAndConfirmWithRetry(connection, txn, { skipPreflight: true, maxRetries: 100 }, 'finalized', 120000);
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