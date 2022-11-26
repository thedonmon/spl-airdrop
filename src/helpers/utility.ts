import { HolderAccount, HolderAccountMetadata } from '../types/holderaccounts';
import * as web3Js from '@solana/web3.js';
import * as fs from 'fs';
import log from 'loglevel';
import { sendAndConfirmWithRetry } from './transaction-helper';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Nft } from '@metaplex-foundation/js';
import axios from 'axios';
import { Metadata } from './metaplexschema';
import { MetadataModel } from '../types/metadata';
import chalk from 'chalk';
import { getAllDomains, getDomainKey, NameRegistryState, performReverseLookup } from '@bonfida/spl-name-service';

export async function promiseAllInOrder<T>(it: (() => Promise<T>)[]): Promise<Iterable<T>> {
  let ret: T[] = [];
  for (const i of it) {
    ret.push(await i());
  }

  return ret;
}

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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function promiseRetry<T>(fn: () => Promise<T>, retries = 5, err?: any): Promise<T> {
  if (err) {
    if (err?.name && err.name === 'TokenOwnerOffCurveError') {
      console.log('Will not retry. Address is a PDA. Specify allow off curve if this is intended');
      return Promise.reject(
        new Error('TokenOwnerOffCurveError.  Specify allow off curve if this is intended'),
      );
    }
    console.log('retrying ', retries);
    console.log(err);
  }
  await new Promise((resolve) => setTimeout(resolve, (5 - retries) * 1000));

  return !retries
    ? Promise.reject(err)
    : fn().catch((error) => promiseRetry(fn, retries - 1, error));
}

export async function timeout(ms: number, retryCount?: number, log?: boolean): Promise<any> {
  if (log) {
    console.log('Waiting for next retry', retryCount);
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const chunkItems = <T>(items: T[], chunkSize?: number) =>
  items.reduce((chunks: T[][], item: T, index) => {
    const chunkSz = chunkSize ?? 50;
    const chunk = Math.floor(index / chunkSz);
    chunks[chunk] = ([] as T[]).concat(chunks[chunk] || [], item);
    return chunks;
  }, []);

export async function getSnapshot(
  mintIds: string[],
  rpcUrl: string | null = null,
  cluster: string = 'devnet',
): Promise<HolderAccount[]> {
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
        let programAccountsConfig = { filters: getFilter, encoding: 'jsonParsed' };
        let tokenResult = await connection.getParsedProgramAccounts(
          TOKEN_PROGRAM_ID,
          programAccountsConfig,
        );
        if (tokenResult && tokenResult.length > 0) {
          let mainAccount = tokenResult.filter(
            (x) =>
              (x.account.data as web3Js.ParsedAccountData).parsed.info.tokenAmount.uiAmount > 0,
          )[0];
          if (mainAccount) {
            let holder: HolderAccount = {
              walletId: (mainAccount.account.data as web3Js.ParsedAccountData).parsed.info.owner,
              totalAmount: (mainAccount.account.data as web3Js.ParsedAccountData).parsed.info
                .tokenAmount.uiAmount,
              mintIds: [item],
            };
            let tryFindAccount = accounts.find((x) => x.walletId == holder.walletId);
            if (tryFindAccount) {
              console.log(
                'account found, updating holder info',
                holder.walletId,
                holder.totalAmount,
                tryFindAccount.totalAmount,
              );
              const acctIndex = accounts.findIndex((x) => x.walletId == holder.walletId);
              let newHolder = tryFindAccount;
              newHolder.mintIds.push(item);
              newHolder.totalAmount = newHolder.totalAmount + holder.totalAmount;
              accounts[acctIndex] = newHolder;
            } else {
              console.log('account not found yet, adding to overall holders', holder.walletId);
              accounts.push(holder);
            }
          }
        }
      }),
    );
  return accounts;
}

export async function getSnapshotWithMetadata(
  mints: Nft[],
  rpcUrl: string | null = null,
  cluster: string = 'devnet',
): Promise<HolderAccountMetadata[]> {
  let accounts: HolderAccountMetadata[] = [];
  const connection = getConnection(cluster, rpcUrl);
  const mintChunks = chunkItems(mints);
  for (const chunk of mintChunks)
    await Promise.all(
      chunk.map(async (item) => {
        item.tokenStandard;
        let filter = {
          memcmp: {
            offset: 0,
            bytes: item.address.toBase58(),
          },
        };
        let filter2 = {
          dataSize: 165,
        };
        let getFilter = [filter, filter2];
        let programAccountsConfig = { filters: getFilter, encoding: 'jsonParsed' };
        let tokenResult = await connection.getParsedProgramAccounts(
          TOKEN_PROGRAM_ID,
          programAccountsConfig,
        );
        if (tokenResult && tokenResult.length > 0) {
          let mainAccount = tokenResult.filter(
            (x) =>
              (x.account.data as web3Js.ParsedAccountData).parsed.info.tokenAmount.uiAmount > 0,
          )[0];
          if (mainAccount) {
            let metadata = await axios.get<MetadataModel>(item.uri);
            let holder: HolderAccountMetadata = {
              walletId: (mainAccount.account.data as web3Js.ParsedAccountData).parsed.info.owner,
              totalAmount: (mainAccount.account.data as web3Js.ParsedAccountData).parsed.info
                .tokenAmount.uiAmount,
              mints: [
                {
                  mint: item.address.toBase58(),
                  name: item.name,
                  image: metadata?.data?.image,
                  attributes: metadata?.data?.attributes,
                },
              ],
            };
            let tryFindAccount = accounts.find((x) => x.walletId == holder.walletId);
            if (tryFindAccount) {
              console.log(
                'account found, updating holder info',
                holder.walletId,
                holder.totalAmount,
                tryFindAccount.totalAmount,
              );
              const acctIndex = accounts.findIndex((x) => x.walletId == holder.walletId);
              let newHolder = tryFindAccount;
              let metadata = await axios.get<MetadataModel>(item.uri);
              newHolder.mints.push({
                mint: item.address.toBase58(),
                name: item.name,
                image: metadata?.data?.image,
                attributes: metadata?.data?.attributes,
              });
              newHolder.totalAmount = newHolder.totalAmount + holder.totalAmount;
              accounts[acctIndex] = newHolder;
            } else {
              console.log('account not found yet, adding to overall holders', holder.walletId);
              accounts.push(holder);
            }
          }
        }
      }),
    );
  return accounts;
}

export function loadWalletKey(keypair: string): web3Js.Keypair {
  if (!keypair || keypair == '') {
    throw new Error('Keypair is required!');
  }
  const loaded = web3Js.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(keypair).toString())),
  );
  log.info(`wallet public key: ${loaded.publicKey}`);
  return loaded;
}

export function getConnection(cluster: string, rpcUrl: string | null): web3Js.Connection {
  const connection =
    rpcUrl != null
      ? new web3Js.Connection(rpcUrl, {
          confirmTransactionInitialTimeout: 120000,
          commitment: 'confirmed',
        })
      : new web3Js.Connection(web3Js.clusterApiUrl(cluster as web3Js.Cluster), {
          confirmTransactionInitialTimeout: 120000,
          commitment: 'confirmed',
        });
  return connection;
}

export async function sendRawTransactionWithRetry(
  connection: web3Js.Connection,
  txn: Buffer,
): Promise<string> {
  const result = await sendAndConfirmWithRetry(
    connection,
    txn,
    { skipPreflight: true, maxRetries: 0 },
    'finalized',
    120000,
  );
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
export function elapsed(
  beginning: number,
  useLogger: boolean = true,
  logger?: any,
  isCli: boolean = false,
) {
  const duration = new Date().getTime() - beginning;
  const msg = isCli ? chalk.blueBright('Safe to quit cmd. Total Elapsed Time: ') : '';
  if (useLogger) {
    if (logger) {
      msg !== ''
        ? logger.info(`${msg}${duration / 1000}s `)
        : logger.debug(`${msg}${duration / 1000}s `);
    } else {
      msg !== '' ? log.info(`${msg}${duration / 1000}s `) : log.debug(`${msg}${duration / 1000}s `);
    }
  }
  return duration;
}

export function getLamports(decimal: number): number {
  if (decimal == 9) {
    return web3Js.LAMPORTS_PER_SOL;
  } else if (decimal == 0) {
    return 1;
  } else {
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

export async function filterRecentTransactions(
  pk: web3Js.PublicKey,
  filterAddress: string,
  connection: web3Js.Connection,
): Promise<(string | undefined)[]> {
  const txns = await connection.getConfirmedSignaturesForAddress2(pk, { limit: 1000 }, 'finalized');
  const txnsParsed = await connection.getParsedTransactions(txns.map((x) => x.signature));
  const txnsP = txnsParsed.filter((x) =>
    x?.transaction.message.accountKeys!.filter((s) => s.pubkey.toBase58() == filterAddress),
  );
  const filteredFound = txnsP
    .flatMap((x) => x?.transaction.message.accountKeys.flatMap((k) => k.pubkey.toBase58()))
    .filter((s) => s == filterAddress);
  return filteredFound;
}

export type Truthy<T> = T extends false | '' | 0 | null | undefined ? never : T; // from lodash

export function truthy<T>(value: T): value is Truthy<T> {
  return !!value;
}

export function calculateSum(obj: any[], field: string) { 
   const res = obj.map(items => items[field])
  .reduce((prev, curr) => prev + curr, 0);
  return res;
}

export async function getPublicKeyFromSolDomain(domain: string, connection?: web3Js.Connection, env: string  = "devnet", rpcUrl: string = ""):Promise<string>{
  const conn = connection || getConnection(env, rpcUrl);
  const { pubkey } = await getDomainKey(domain);
  const owner = (await NameRegistryState.retrieve(conn, pubkey)).registry.owner.toBase58();
  console.log(`The owner of SNS Domain: ${domain} is: `,owner);
  return owner;
}

export async function getSolDomainsFromPublicKey(wallet: string, connection?: web3Js.Connection, env: string  = "devnet", rpcUrl: string = ""):Promise<string[]>{
  const ownerWallet = new web3Js.PublicKey(wallet);
  const conn = connection || getConnection(env, rpcUrl);
  const allDomainKeys = await getAllDomains(conn, ownerWallet);
  const allDomainNames = await Promise.all(allDomainKeys.map(key=>{return performReverseLookup(conn,key)}));
  console.log(`${wallet} owns the following SNS domains:`)
  allDomainNames.forEach((domain,i) => console.log(` ${i+1}.`,domain));
  return allDomainNames;
}