import { HolderAccount, HolderAccountMetadata } from '../types/holderaccounts';
import * as web3Js from '@solana/web3.js';
import * as fs from 'fs';
import log from 'loglevel';
import * as cliProgress from 'cli-progress';
import ora from 'ora';
import cliSpinners from 'cli-spinners';
import { sendAndConfirmWithRetry } from './transaction-helper';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Nft } from '@metaplex-foundation/js';
import axios from 'axios';
import { Metadata } from './metaplexschema';
import { MetadataModel } from '../types/metadata';
import { getAssetsByCollection, parseTransactionForAddressByType } from "../types/helius/fetch";
import chalk from 'chalk';
import {
  filterMarketPlacesByWallet,
  filterMarketPlacesByHolders,
  filterMarketPlacesByHoldersMetadata,
} from '../spltokenairdrop';
import {
  getAllDomains,
  getDomainKey,
  NameRegistryState,
  performReverseLookup,
} from '@bonfida/spl-name-service';
import BN from 'bn.js';
import BigNumber from 'bignumber.js';

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


  export async function getSnapshotByCollectionV2(collectionId: string, heliusUrl: string) {
    const assets = await getAssetsByCollection(heliusUrl, collectionId);
    const accountsMap = new Map<string, HolderAccount>();
    const progressBar = getProgressBar();
    log.info(`Total assets in collection: ${assets.results.length}`);
    progressBar.start(assets.results.length, 0);
    log.info(`Fetching accounts...`);
    for (const asset of assets.results) {
      const walletId = asset.ownership.owner;
      const existingHolder = accountsMap.get(walletId);

      if (existingHolder) {
        existingHolder.mintIds.push(asset.id);
        existingHolder.totalAmount += 1;
      } else {
        accountsMap.set(walletId, {
          walletId: walletId,
          totalAmount: 1,
          mintIds: [asset.id],
        });
      }
      progressBar.increment();
    }
    const accounts = Array.from(accountsMap.values());
    progressBar.stop();
    return accounts;
  }  

  export async function getSnapshotByCollectionWithMetadataV2(collectionId: string, heliusUrl: string) {
    const assets = await getAssetsByCollection(heliusUrl, collectionId);
    const accountsMap = new Map<string, HolderAccountMetadata>();
    
    for (const asset of assets.results) {
      const walletId = asset.ownership.owner;
      const existingHolder = accountsMap.get(walletId);

      if (existingHolder) {
        existingHolder.mints.push({
          mint: asset.id,
          name: asset.content.metadata.name,
          image: asset.content.files[0].uri,
          attributes: asset.content.metadata.attributes
        });
        existingHolder.totalAmount += 1;
      } else {
        accountsMap.set(walletId, {
          walletId: walletId,
          totalAmount: 1,
          mints: [{
            mint: asset.id,
            name: asset.content.metadata.name,
            image: asset.content.files[0].uri,
            attributes: asset.content.metadata.attributes
          }],
        });
      }
    }
    const accounts = Array.from(accountsMap.values());
  
    log.info("Unqiue Accounts: ", accounts.length);
    return accounts;
  }  

  export async function getMintIdsByCollectionV2(collectionId: string, heliusUrl: string) {
    const assets = await getAssetsByCollection(heliusUrl, collectionId);
    return assets.results.map((asset) => asset.id);
  }

  export async function getFirstMintersByCollection(collectionId: string, heliusUrl: string, heliusApiKey: string, env: string = "devnet") {
    const mintIds = await getMintIdsByCollectionV2(collectionId, heliusUrl);
    const progressBar = getProgressBar();
    progressBar.start(mintIds.length, 0);
    const mintIdChunks = chunkItems(mintIds, 250);
    const mintersMap = new Map();
    log.log("Fetched mint IDs...", mintIds.length)
    for (const chunk of mintIdChunks) {
        for (const mintId of chunk) {
            const mintersTx = await parseTransactionForAddressByType(mintId, heliusApiKey, "NFT_MINT", env);
            if (mintersTx.length > 1) {
                console.warn(`Multiple minters found for ${mintId}: `, mintersTx.length);
            }
            const walletId = mintersTx[0].feePayer;
            const existingHolder = mintersMap.get(walletId);

            if (existingHolder) {
                existingHolder.mintIds.push(mintId);
                existingHolder.totalAmount += 1;
            } else {
                mintersMap.set(walletId, {
                    walletId: walletId,
                    totalAmount: 1,
                    mintIds: [mintId],
                });
            }
            progressBar.increment();
        }
    }
    progressBar.stop();
    const minters = Array.from(mintersMap.values());
    console.log("Minters: ", minters);
    return minters;
}

export async function getFirstMintersByCollectionPA(collectionId: string, heliusUrl: string, heliusApiKey: string, env: string = "devnet") {
  const mintIds = await getMintIdsByCollectionV2(collectionId, heliusUrl);
  const mintIdChunks = chunkItems(mintIds);
  const mintersMap = new Map();
  const progressBar = getProgressBar();
  progressBar.start(mintIds.length, 0);
  log.info("Fetched mint IDs...", mintIds.length)
  for (const chunk of mintIdChunks) {
      const mintersPromises = chunk.map(async (mintId) => {
          const mintersTx = await parseTransactionForAddressByType(mintId, heliusApiKey, "NFT_MINT", env);
          if (mintersTx.length > 1) {
              log.warn(`Multiple minters found for ${mintId}: `, mintersTx.length);
          }
          progressBar.increment();
          return {
              mintId,
              walletId: mintersTx[0].feePayer
          };
      });

      const mintersChunk = await Promise.all(mintersPromises);

      for (const minter of mintersChunk) {
          const { mintId, walletId } = minter;
          const existingHolder = mintersMap.get(walletId);

          if (existingHolder) {
              existingHolder.mintIds.push(mintId);
              existingHolder.totalAmount += 1;
          } else {
              mintersMap.set(walletId, {
                  walletId: walletId,
                  totalAmount: 1,
                  mintIds: [mintId],
              });
          }
      }
  }
  progressBar.stop();
  const minters = Array.from(mintersMap.values());
  console.log("Minters: ", minters);
  return minters;
}

export async function getSnapshot(
  mintIds: string[],
  rpcUrl: string | null = null,
  cluster: string = 'devnet',
  filterMktplaces: boolean = false,
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
  filterMktplaces ? (accounts = filterMarketPlacesByHolders(accounts)) : accounts;
  return accounts;
}

export async function getSnapshotWithMetadata(
  mints: Nft[],
  rpcUrl: string | null = null,
  cluster: string = 'devnet',
  filterMktplaces: boolean = false,
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
  filterMktplaces ? (accounts = filterMarketPlacesByHoldersMetadata(accounts)) : accounts;
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
  const res = obj.map((items) => items[field]).reduce((prev, curr) => prev + curr, 0);
  return res;
}

export async function getPublicKeyFromSolDomain(
  domain: string,
  connection?: web3Js.Connection,
  env: string = 'devnet',
  rpcUrl: string = '',
): Promise<string> {
  const conn = connection || getConnection(env, rpcUrl);
  const { pubkey } = await getDomainKey(domain);
  const owner = (await NameRegistryState.retrieve(conn, pubkey)).registry.owner.toBase58();
  console.log(`The owner of SNS Domain: ${domain} is: `, owner);
  return owner;
}

export async function getSolDomainsFromPublicKey(
  wallet: string,
  connection?: web3Js.Connection,
  env: string = 'devnet',
  rpcUrl: string = '',
): Promise<string[]> {
  const ownerWallet = new web3Js.PublicKey(wallet);
  const conn = connection || getConnection(env, rpcUrl);
  const allDomainKeys = await getAllDomains(conn, ownerWallet);
  const allDomainNames = await Promise.all(
    allDomainKeys.map((key) => {
      return performReverseLookup(conn, key);
    }),
  );
  console.log(`${wallet} owns the following SNS domains:`);
  allDomainNames.forEach((domain, i) => console.log(` ${i + 1}.`, domain));
  return allDomainNames;
}

export function isValidHttpUrl(testUrl: string): boolean {
  let url;
  try {
    url = new URL(testUrl);
  } catch (_) {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export function getProgressBar(): cliProgress.SingleBar {
  return new cliProgress.SingleBar(
    {
      format: 'Progress: [{bar}] {percentage}% | {value}/{total} ',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
    },
    cliProgress.Presets.shades_classic,
  );
}

export function getSpinner(text?: string): ora.Ora {
  const spinner = ora({
    text: text ?? 'Transferring, please wait...',
    spinner: cliSpinners.material,
  });
  spinner.color = 'yellow';
  return spinner;
}


/**
 * Converts a ui representation of a token amount into its native value as `BN`, given the specified mint decimal amount (default to 6 for USDC).
 */
export function toNumber(amount: number | string | BigNumber | bigint | BN): number {
  let amt: number;
  if (typeof amount === 'number') {
    amt = amount;
  } else if (typeof amount === 'string') {
    amt = Number(amount);
  } else if (typeof amount === 'bigint') {
    amt = Number(amount.toString());
  } else {
    amt = amount.toNumber();
  }
  return amt;
}

/**
 * Converts a ui representation of a token amount into its native value as `BN`, given the specified mint decimal amount (default to 6 for USDC).
 */
export function toBigNumber(
  amount: number | string | BigNumber | BN | bigint,
): BigNumber {
  let amt: BigNumber;
  if (amount instanceof BigNumber) {
    amt = amount;
  } else {
    amt = new BigNumber(amount.toString());
  }
  return amt;
}

/**
 * Converts a UI representation of a token amount into its native value as `BN`, given the specified mint decimal amount (default to 6 for USDC).
 */
export function uiToNative(
  amount: number | string | BigNumber | bigint,
  decimals: number,
): BN {
  const amt = toBigNumber(amount);
  return new BN(amt.times(10 ** decimals).toFixed(0, BigNumber.ROUND_FLOOR));
}

export function uiToNativeBigNumber(
  amount: number | string | BigNumber | bigint,
  decimals: number,
): BigNumber {
  const amt = toBigNumber(amount);
  return amt.times(10 ** decimals);
}

/**
 * Converts a native representation of a token amount into its UI value as `number`, given the specified mint decimal amount (default to 6 for USDC).
 */
export function nativeToUi(
  amount: number | string | BigNumber | BN | bigint,
  decimals: number,
): number {
  const amt = toBigNumber(amount);
  return amt.div(10 ** decimals).toNumber();
}

export function roundToDecimalPlace(num: number, places: number) {
  const multiplier = Math.pow(10, places);
  return Math.round(num * multiplier) / multiplier;
}
