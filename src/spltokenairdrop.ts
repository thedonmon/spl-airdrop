import * as splToken from '@solana/spl-token';
import * as cliProgress from 'cli-progress';
import path from 'path';
import axios from 'axios';
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
import { getOrCreateTokenAccountInstruction, sendAndConfirmWithRetry, sendAndConfirmWithRetryBlockStrategy } from './helpers/transaction-helper';
import {
  ITransferRequest,
  TransferErrorRequest,
  TransferMintRequest,
} from './types/transferRequest';
import { AccountLayout, RawAccount } from '@solana/spl-token';
import ora from 'ora';
import cliSpinners from 'cli-spinners';

export async function airdropToken(request: AirdropCliRequest): Promise<any> {
  const {
    keypair,
    whitelistPath,
    transferAmount,
    cluster = 'devnet',
    rpcUrl = null,
    simulate = false,
    batchSize = 250,
    exclusionList = [],
    mintIfAuthority,
    overrideBalanceCheck = false,
  } = request;
  let jsonData: any = {};
  const data = fs.readFileSync(whitelistPath!, 'utf8');
  jsonData = JSON.parse(data);
  var connection = utility.getConnection(cluster, rpcUrl);
  const fromWallet = keypair.publicKey;
  const mint = jsonData.mint as string;
  let addresses = jsonData.wallets as string[];
  addresses = filterMarketPlacesByWallet(addresses);
  if (exclusionList.length > 0) {
    addresses = addresses.filter((item) => !exclusionList.includes(item));
  }
  if (simulate) {
    console.log(addresses);
    return addresses.map((x) => ({ wallet: x, transferAmt: transferAmount }));
  }
  const mintPk = new web3Js.PublicKey(mint);
  const mintObj = await splToken.getMint(
    connection,
    mintPk,
    'confirmed',
    splToken.TOKEN_PROGRAM_ID,
  );
  const amountToTransfer = utility.getLamports(mintObj.decimals) * transferAmount!;
  const progressBar = getProgressBar();
  progressBar.start(addresses.length, 0);
  const ownerAta = await splToken.getAssociatedTokenAddress(
    mintPk,
    new web3Js.PublicKey(fromWallet),
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const walletChunks = utility.chunkItems(addresses, batchSize);
  overrideBalanceCheck
    ? log.warn(`Overriding balance check. Sending amount ${amountToTransfer}`)
    : null;
  for (let walletChunk of walletChunks) {
    await Promise.all(
      walletChunk.map(async (toWallet, index) => {
        let start = utility.now();
        try {
          const toWalletPk = new web3Js.PublicKey(toWallet);
          const { instruction: createAtaIx, accountKey: toWalletAta, accountInfo } = 
          await getOrCreateTokenAccountInstruction(mintPk, toWalletPk, connection, keypair.publicKey, false);
          let parsedAccountInfo: RawAccount | undefined;
          if (accountInfo) {
            parsedAccountInfo = AccountLayout.decode(accountInfo.data);
          }
          const parsedAmount = parsedAccountInfo?.amount;
          if ((parsedAmount && parsedAmount < amountToTransfer && !overrideBalanceCheck) || !parsedAmount || overrideBalanceCheck) {
            await tryMintTo({
              mintObj,
              walletAta: toWalletAta,
              tokenMint: mintPk,
              connection,
              keypair,
              totalTransferAmt: amountToTransfer,
              ownerAta,
              fromWallet,
              toWallet: toWalletPk,
              mintIfAuthority,
              createAtaInstruction: createAtaIx
            });
          } else {
            log.warn(chalk.yellow(`${toWallet} already has token ${mint}`));
          }
        } catch (err: any) {
          const message = `ERROR: Sending ${transferAmount} of ${mint} to ${toWallet} failed. \n`;
          let errorMsg: TransferError = {
            wallet: toWallet,
            mint: mint,
            transferAmount: transferAmount!,
            message: message,
            error: err.message,
          };
          handleError(errorMsg, LogFiles.TransferErrorJson, LogFiles.TokenTransferErrorsTxt);
        } finally {
          progressBar.increment();
          utility.elapsed(start, true, log);
        }
      }),
    );
  }
  progressBar.stop();
  return Promise.resolve();
}

export async function airdropTokenPerNft(request: AirdropTypeRequest<HolderAccount>): Promise<any> {
  const {
    keypair,
    holdersList,
    tokenMint,
    decimals,
    transferAmount,
    cluster = 'devnet',
    rpcUrl = null,
    simulate = false,
    batchSize = 50,
    exclusionList = [],
  } = request;
  var connection = utility.getConnection(cluster, rpcUrl);
  const fromWallet = keypair.publicKey;
  let holders: HolderAccount[] = filterMarketPlacesByHolders(holdersList!);
  let decimalsToUse = utility.getLamports(decimals!);
  console.log(holders.length, holdersList!.length);
  if (exclusionList.length > 0) {
    holders = holders.filter((item) => !exclusionList.includes(item.walletId));
  }
  if (simulate) {
    return holders.map((x) => {
      return {
        wallet: x.walletId,
        transferAmt: transferAmount! * x.totalAmount * decimalsToUse,
      };
    });
  }

  const progressBar = getProgressBar();
  const ownerAta = await splToken.getAssociatedTokenAddress(
    tokenMint!,
    new web3Js.PublicKey(fromWallet),
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const walletChunks = utility.chunkItems(holders, batchSize);
  progressBar.start(holders.length, 0);

  for (let walletChunk of walletChunks) {
    await Promise.all(
      walletChunk.map(async (toWallet, index) => {
        let start = utility.now();
        const totalTransferAmt = transferAmount! * toWallet.totalAmount * decimalsToUse;
        try {
          await tryTransfer({
            toWallet,
            tokenMint,
            connection,
            keypair,
            totalTransferAmt,
            ownerAta,
            fromWallet,
          });
        } catch (err: any) {
          const message = `ERROR: Sending ${totalTransferAmt} of ${tokenMint!.toBase58()} to ${
            toWallet.walletId
          } failed. \n`;
          let errorMsg: TransferError = {
            wallet: toWallet.walletId,
            mint: tokenMint!.toBase58(),
            holdings: toWallet.totalAmount,
            transferAmount: totalTransferAmt,
            message: message,
            error: err.message,
          };
          handleError(errorMsg, LogFiles.TransferErrorJson, LogFiles.TokenTransferNftTxt);
        } finally {
          progressBar.increment();
          utility.elapsed(start, true, log);
        }
      }),
    );
  }
  progressBar.stop();
  Promise.resolve();
}

export async function airdropNft(request: AirdropCliRequest): Promise<any> {
  const {
    keypair,
    whitelistPath,
    mintlistPath,
    cluster = 'devnet',
    rpcUrl = null,
    simulate = false,
    batchSize = 50,
  } = request;
  let jsonData: any = {};
  const data = fs.readFileSync(whitelistPath!, 'utf8');
  const mintlist = fs.readFileSync(mintlistPath!, 'utf8');
  jsonData = JSON.parse(data);
  const mintListArr = JSON.parse(mintlist) as string[];
  const connection = utility.getConnection(cluster, rpcUrl);
  const fromWallet = keypair.publicKey;
  const distributionList = jsonData.distributionList as any[];
  let mintsTransferList: MintTransfer[] = [];
  console.log(distributionList);
  for (let distro of distributionList) {
    const mintsToTransfer = mintListArr.splice(0, distro.nFtsToAirdrop);
    const mintsObj = mintsToTransfer.map((x) => new MintTransfer(distro.wallet.trim(), x));
    mintsTransferList = _.concat(mintsTransferList, mintsObj);
  }

  mintsTransferList = filterMarketPlaces(mintsTransferList);
  if (simulate) {
    return mintsTransferList;
  }
  const progressBar = getProgressBar();
  progressBar.start(mintsTransferList.length, 0);

  const mintTransferChunks = utility.chunkItems(mintsTransferList, batchSize);
  for (let mintTransferChunk of mintTransferChunks) {
    await Promise.all(
      mintTransferChunk.map(async (mint, index) => {
        let start = utility.now();
        try {
          const ownerAta = await splToken.getAssociatedTokenAddress(
            new web3Js.PublicKey(mint.mintId),
            new web3Js.PublicKey(fromWallet),
            false,
            splToken.TOKEN_PROGRAM_ID,
            splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
          );
          await tryTransferMint({
            toWallet: mint,
            connection,
            keypair,
            totalTransferAmt: 1,
            ownerAta,
            fromWallet,
          });
        } catch (err: any) {
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
        } finally {
          progressBar.increment();
        }
      }),
    );
  }
  progressBar.stop();
  return Promise.resolve();
}

function handleError(
  errorMsg: TransferError,
  transferErrorJsonPath: string,
  transferErrorTxtPath: string,
): void {
  log.error(chalk.red(errorMsg.message));
  fs.appendFileSync(transferErrorTxtPath, JSON.stringify(errorMsg.message, null, 2) + '\n');
  if (!fs.existsSync(transferErrorJsonPath)) {
    fs.writeFileSync(transferErrorJsonPath, JSON.stringify([]));
  }
  const errorString = fs.readFileSync(transferErrorJsonPath, 'utf-8');
  if (errorString) {
    const jsonErrors = JSON.parse(errorString) as TransferError[];
    jsonErrors.push(errorMsg);
    const writeJson = JSON.stringify(jsonErrors);
    fs.writeFileSync(transferErrorJsonPath, writeJson);
  } else {
    let newError = [errorMsg];
    const writeJson = JSON.stringify(newError);
    fs.writeFileSync(transferErrorJsonPath, writeJson);
  }
}

export async function retryErrors(
  keypair: web3Js.Keypair,
  errorJsonFilePath: string,
  cluster: string = 'devnet',
  rpcUrl: string | null = null,
  simulate: boolean = false,
  batchSize: number = 5,
): Promise<any> {
  let jsonData: any = {};
  const data = fs.readFileSync(errorJsonFilePath, 'utf8');
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
    await Promise.all(
      retrtyErrorChunk.map(async (retryError, index) => {
        let start = utility.now();
        try {
          const ownerAta = await splToken.getAssociatedTokenAddress(
            new web3Js.PublicKey(retryError.mint),
            new web3Js.PublicKey(fromWallet),
            false,
            splToken.TOKEN_PROGRAM_ID,
            splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
          );
          const walletAta = await utility.promiseRetry(() =>
            splToken.getOrCreateAssociatedTokenAccount(
              connection,
              keypair,
              new web3Js.PublicKey(retryError.mint),
              new web3Js.PublicKey(retryError.wallet),
              false,
              'confirmed',
              { skipPreflight: true, maxRetries: 100 },
              splToken.TOKEN_PROGRAM_ID,
              splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
          );
          if (walletAta.amount < retryError.transferAmount) {
            await tryTransferError({
              toWallet: retryError,
              connection,
              keypair,
              ownerAta,
              fromWallet,
              closeAccounts: retryError.isNFT,
            });
          } else {
            log.warn(chalk.yellow(`${retryError.wallet} already has token ${retryError.mint}`));
          }
          utility.elapsed(start, true, log);
        } catch (err: any) {
          const message = `ERROR: Failed AGAIN to send ${retryError.mint} to ${retryError.wallet}.`;
          let errorMsg: TransferError = {
            wallet: retryError.wallet,
            mint: retryError.mint,
            transferAmount: retryError.transferAmount,
            message: message,
            error: err.message,
          };
          handleError(errorMsg, LogFiles.RetryTransferErrorJson, LogFiles.RetryTransferErrorTxt);
        } finally {
          progressBar.increment();
        }
      }),
    );
  }
  progressBar.stop();
  Promise.resolve();
}

export function formatNftDrop(
  holderAccounts: HolderAccount[],
  amountPerMint: number,
): Distribution[] {
  let mintTfer: Distribution[] = [];
  for (var wallet of holderAccounts) {
    const holderAcct: Distribution = {
      wallet: wallet.walletId,
      totalOwnedNftsCount: wallet.totalAmount,
      nFtsToAirdrop: wallet.totalAmount * amountPerMint,
    };
    mintTfer.push(holderAcct);
  }
  return mintTfer;
}

export async function getTransferTransactionInfo(
  transactionHashes: string[],
  cluster: string = 'devnet',
  rpcUrl: string | null = null,
  txnOptions?: TransactionInfoOptions,
): Promise<any[]> {
  let accountsToExclude: any[] = [];
  const connection = utility.getConnection(cluster, rpcUrl);
  log.info(`Fetching ${transactionHashes.length} txns...`);
  const parsedTransactions = await connection.getParsedTransactions(transactionHashes);
  log.info(`Fetched ${transactionHashes.length} txns... parsing...`);
  const progressBar = getProgressBar();
  progressBar.start(parsedTransactions.length, 0);
  for (const txn of parsedTransactions) {
    const account = txnOptions
      ? txnOptions.excludeAddress && txnOptions.excludeSigner
        ? txn?.transaction.message.accountKeys.filter(
            (x) => !x.signer && x.pubkey.toBase58() !== txnOptions.excludeAddress,
          )
        : txn?.transaction.message.accountKeys
      : txn?.transaction.message.accountKeys;
    const accountTransfered = account ? account[0] : undefined;

    if (accountTransfered) {
      const accountInfo = await connection.getParsedAccountInfo(accountTransfered.pubkey);
      const parsed = (accountInfo?.value?.data as web3Js.ParsedAccountData)
        ?.parsed as ParsedAccountDataType;
      if (parsed) {
        if (txnOptions && txnOptions.getInfo) {
          accountsToExclude.push(parsed);
        } else {
          accountsToExclude.push(parsed.info.owner);
        }
      } else {
        log.warn('Couldnt parse account info \n', accountTransfered.pubkey.toBase58());
      }
      progressBar.increment();
    }
  }
  progressBar.stop();
  return accountsToExclude;
}

export function formatNftDropByWallet(
  holderAccounts: string[],
  amountPerMint: number,
): Distribution[] {
  let mintTfer: Distribution[] = [];
  for (var wallet of holderAccounts) {
    const holderAcct: Distribution = {
      wallet: wallet,
      totalOwnedNftsCount: 1,
      nFtsToAirdrop: amountPerMint,
    };
    mintTfer.push(holderAcct);
  }
  return mintTfer;
}

export function formatNftDropByWalletMultiplier(
    holderAccounts: {wallet_id: string, nft_count: number}[],
    multiplierPerMint: number,
  ): Distribution[] {
    let mintTfer: Distribution[] = [];
    for (var holder of holderAccounts) {
      let nftsToDrop = holder.nft_count * multiplierPerMint;
      if (holder.nft_count >= 10 && holder.nft_count < 30) {
        nftsToDrop = holder.nft_count + 1;
      }
      else if (holder.nft_count >= 30) {
        nftsToDrop = holder.nft_count + 2;
      }
      else {
        nftsToDrop = holder.nft_count;
      }
      const holderAcct: Distribution = {
        wallet: holder.wallet_id,
        totalOwnedNftsCount: holder.nft_count,
        nFtsToAirdrop: nftsToDrop,
      };
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
      mintIds: jsonData[wallet].mints,
    };
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

export function downloadMintImages(mintsPath: string): Promise<any> {
  const mintData = fs.readFileSync(mintsPath, 'utf-8');
  const jsonData = JSON.parse(mintData) as any[];
  const progressBar = getProgressBar();
  progressBar.start(jsonData.length, 0);
  return Promise.all(
    jsonData.map(async (data) => {
      const arweave = data.uri;
      try {
        if (arweave && arweave.includes('https://')) {
          log.info(`Downloading ${arweave}`);

          const arweaveData = await axios.get(arweave);
          const response = arweaveData.data;
          log.info(`Downloaded ${JSON.stringify(response)}`);
          let imageName = response.name?.replace(' ', '_') ?? data.mint;
          imageName = `${imageName}.png`;
          const imageUrl = response.image;
          await downloadFile(
            imageUrl,
            '/Users/davidmaman/SourceCode/spl-airdrop/src/images',
            imageName,
          );
          progressBar.increment();
        } else {
          log.warn(`No arweave uri for ${data.mint}`);
        }
      } catch (err: any) {
        log.error(`Error downloading ${data.mint}`, err);
      }
    }),
  );
}

async function downloadFile(fileUrl: string, downloadFolder: string, name: string): Promise<any> {
  // Get the file name
  const fileName = path.basename(name);

  // The path of the downloaded file on our machine
  const localFilePath = path.resolve(__dirname, downloadFolder, fileName);
  console.log('localFilePath', localFilePath);
  try {
    const response = await axios({
      method: 'GET',
      url: fileUrl,
      responseType: 'stream',
    });
    console.log('response', response);

    const w = response.data.pipe(fs.createWriteStream(localFilePath));
    w.on('finish', () => {
      console.log('Successfully downloaded file!');
    });
  } catch (err: any) {
    console.error(`Error downloading ${fileUrl}`, err);
    throw new Error(err);
  }
}

export function formatHoldersToWallet(
  snapShotFilePath: string,
  perMint: boolean = false,
  randomize: boolean = false,
  filterMp: boolean = true,
): string[] {
  const stringData = fs.readFileSync(snapShotFilePath, 'utf-8');
  let jsonData = JSON.parse(stringData) as HolderAccount[];
  let wallets: string[] = [];
  if (perMint) {
    if (filterMp) {
      jsonData = filterMarketPlacesByHolders(jsonData);
    }
    for (var wallet of jsonData) {
      //wallets.push(`${wallet.walletId}:${wallet.mintIds.length}`);
      for (var mint of wallet.mintIds) {
          wallets.push(wallet.walletId);
      }
    }
  } else {
    // per wallet
    if (filterMp) {
      jsonData = filterMarketPlacesByHolders(jsonData);
    }
    for (var wallet of jsonData) {
      wallets.push(wallet.walletId);
    }
  }
  if (randomize) {
    wallets = _.shuffle(wallets);
  }
  return wallets;
}

async function tryMintTo(
  request: TransferMintRequest<web3Js.PublicKey>,
): Promise<{ txid: string }> {
  let {
    mintObj,
    walletAta,
    tokenMint,
    connection,
    keypair,
    totalTransferAmt,
    ownerAta,
    fromWallet,
    toWallet,
    mintIfAuthority = true,
    createAtaInstruction,
  } = request;
  const blockhashResponse = await connection.getLatestBlockhashAndContext();
  const txn = new web3Js.Transaction({
    feePayer: keypair.publicKey,
    blockhash: blockhashResponse.value.blockhash,
    lastValidBlockHeight: blockhashResponse.value.lastValidBlockHeight,
  });
  if (createAtaInstruction) {
    txn.add(createAtaInstruction);
  }
  let txnIx: web3Js.TransactionInstruction;
  if (mintObj.mintAuthority?.toBase58() == keypair.publicKey.toBase58() && mintIfAuthority) {
    txnIx = splToken.createMintToInstruction(
      mintObj.address,
      walletAta,
      keypair.publicKey,
      totalTransferAmt!,
      undefined,
      splToken.TOKEN_PROGRAM_ID,
    );
  } else {
    txnIx = splToken.createTransferInstruction(
      ownerAta,
      walletAta,
      fromWallet,
      totalTransferAmt!,
      [keypair],
      splToken.TOKEN_PROGRAM_ID,
    );
  }
  txn.add(txnIx);
  txn.sign(keypair);
  const signature = await sendAndConfrimInternal(connection, txn);
  let message = `${mintIfAuthority ? 'Minted ' : 'Transferred '} ${totalTransferAmt} of ${splicer(
    tokenMint!.toBase58(),
  )} to ${toWallet.toBase58()}. https://solscan.io/tx/${signature.txid}  \n`;
  log.info(
    chalk.green(`${mintIfAuthority ? 'Minted ' : 'Transferred '}`) +
      chalk.yellow(`${totalTransferAmt}`) +
      chalk.green(` of ${splicer(tokenMint!.toBase58())} to ${splicer(toWallet.toBase58())} `) +
      chalk.blue(` \n https://solscan.io/tx/${signature.txid} \n`),
  );
  fs.appendFileSync(LogFiles.TokenTransferTxt, message);
  return signature;
}

async function tryTransfer(request: ITransferRequest<HolderAccount>): Promise<{ txid: string }> {
  let { toWallet, tokenMint, connection, keypair, totalTransferAmt, ownerAta, fromWallet } =
    request;
  const transfer = await prepTransfer(
    {
      toWallet: new web3Js.PublicKey(toWallet.walletId),
      tokenMint: tokenMint!,
      totalTransferAmt: totalTransferAmt!,
      connection,
      keypair,
      ownerAta,
      fromWallet,
    },
    false,
  );
  const signature = await sendAndConfrimInternal(connection, transfer.txn);
  let message = `Sent ${totalTransferAmt} of ${splicer(
    tokenMint!.toBase58(),
  )} to ${transfer.destination.toBase58()}. https://solscan.io/tx/${signature.txid}  \n`;
  log.info(
    chalk.green('Sent ') +
      chalk.yellow(`${totalTransferAmt}`) +
      chalk.green(
        ` of ${splicer(tokenMint!.toBase58())} to ${splicer(transfer.destination.toBase58())} `,
      ) +
      chalk.blue(` \n https://solscan.io/tx/${signature.txid} \n`),
  );
  fs.appendFileSync(LogFiles.TokenTransferTxt, message);
  return signature;
}

async function tryTransferError(
  request: TransferErrorRequest<TransferError>,
): Promise<{ txid: string }> {
  let { toWallet, connection, keypair, ownerAta, fromWallet, closeAccounts } = request;
  const transfer = await prepTransfer(
    {
      toWallet: new web3Js.PublicKey(toWallet.wallet),
      tokenMint: new web3Js.PublicKey(toWallet.mint),
      totalTransferAmt: toWallet.transferAmount,
      connection,
      keypair,
      ownerAta,
      fromWallet,
    },
    closeAccounts,
  );
  const signature = await sendAndConfrimInternal(connection, transfer.txn);
  let message = `Sent ${toWallet.transferAmount} of ${splicer(
    transfer.mint.toBase58(),
  )} to ${transfer.destination.toBase58()} .https://solscan.io/tx/${signature.txid}  \n`;
  log.info(
    chalk.green('Sent ') +
      chalk.yellow(`${toWallet.transferAmount}`) +
      chalk.green(
        ` of ${splicer(transfer.mint.toBase58())} to ${splicer(transfer.destination.toBase58())} `,
      ) +
      chalk.blue(`\n https://solscan.io/tx/${signature.txid} \n`),
  );
  fs.appendFileSync(LogFiles.RetryTransferTxt, message);
  return signature;
}

async function tryTransferMint(request: ITransferRequest<MintTransfer>): Promise<{ txid: string }> {
  let { toWallet, connection, keypair, totalTransferAmt, ownerAta, fromWallet } = request;
  const transfer = await prepTransfer(
    {
      toWallet: new web3Js.PublicKey(toWallet.wallet),
      tokenMint: new web3Js.PublicKey(toWallet.mintId),
      totalTransferAmt: totalTransferAmt!,
      connection,
      keypair,
      ownerAta,
      fromWallet,
    },
    true,
  );
  const signature = await sendAndConfrimInternal(connection, transfer.txn);
  let message = `Sent ${totalTransferAmt} of ${transfer.mint.toBase58()} to ${
    transfer.destination
  }. https://solscan.io/tx/${signature.txid} \n`;
  log.info(
    chalk.green('Sent ') +
      chalk.yellow(` ${totalTransferAmt} `) +
      chalk.green(
        ` of ${splicer(transfer.mint.toBase58())}.. to ${splicer(
          transfer.destination.toBase58(),
        )}.. `,
      ) +
      chalk.blue(`\n https://solscan.io/tx/${signature.txid} \n `),
  );
  fs.appendFileSync(LogFiles.TransferNftTxt, message);
  return signature;
}

async function prepTransfer(
  request: ITransferRequest<web3Js.PublicKey>,
  createCloseIx: boolean = false,
): Promise<Transfer> {
  let { toWallet, tokenMint, totalTransferAmt, connection, keypair, ownerAta, fromWallet } =
    request;
  const toWalletPk = new web3Js.PublicKey(toWallet);
  const mintPk = tokenMint!;
  const { instruction: createAtaIx, accountKey: walletAta } = await getOrCreateTokenAccountInstruction(mintPk, toWalletPk, connection, keypair.publicKey);
  const txnIns = splToken.createTransferInstruction(
    ownerAta,
    walletAta,
    fromWallet,
    totalTransferAmt!,
    [keypair],
    splToken.TOKEN_PROGRAM_ID,
  );
  const blockhashResponse = await connection.getLatestBlockhashAndContext();
  const txn = new web3Js.Transaction({
    feePayer: keypair.publicKey,
    blockhash: blockhashResponse.value.blockhash,
    lastValidBlockHeight: blockhashResponse.value.lastValidBlockHeight,
  })
  if (createAtaIx) {
    txn.add(createAtaIx)
  }
  txn.add(txnIns);
  txn.feePayer = fromWallet;
  if (createCloseIx) {
    const closeAccount = splToken.createCloseAccountInstruction(
      ownerAta,
      keypair.publicKey,
      keypair.publicKey,
      undefined,
      splToken.TOKEN_PROGRAM_ID,
    );
    txn.add(closeAccount);
  }
  txn.sign(keypair);
  return {
    txn: txn,
    mint: mintPk,
    destination: toWalletPk,
  };
}

async function sendAndConfrimInternal(
  connection: web3Js.Connection,
  txn: web3Js.Transaction,
  sendOptions: web3Js.SendOptions = {
    maxRetries: 0,
    skipPreflight: true,
  },
  commitment: web3Js.Commitment = 'confirmed',
  blockhashResponse?: web3Js.RpcResponseAndContext<{ blockhash: web3Js.Blockhash, lastValidBlockheight: number }>,
): Promise<{ txid: string }> {
  const spinner = getSpinner();
  spinner.start();
  const txnSerialized = txn.serialize();
  const signature = await sendAndConfirmWithRetryBlockStrategy(
    connection,
    txnSerialized,
    sendOptions,
    commitment,
    blockhashResponse,
  );
  if (signature) {
    spinner.succeed();
  }
  else {
    spinner.stop();
  }
  return signature;
}

function filterMarketPlaces(transfers: MintTransfer[]): MintTransfer[] {
  return transfers.filter((x) => isNotMarketPlace(x.wallet));
}

function filterMarketPlacesByHolders(transfers: HolderAccount[]): HolderAccount[] {
  let arr = _.filter(transfers, (x) => isNotMarketPlace(x.walletId));
  return arr;
}

function filterMarketPlacesByWallet(wallets: string[]): string[] {
  return wallets.filter((x) => isNotMarketPlace(x));
}

function isNotMarketPlace(walletId: string): boolean {
  const mktplaces = [
    MarketPlaces.MagicEden,
    MarketPlaces.MagicEden2,
    MarketPlaces.AlphaArt,
    MarketPlaces.DigitalEyes,
    MarketPlaces.ExchangeArt,
    MarketPlaces.Solanart,
  ];
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

function getSpinner(text?: string) : ora.Ora {
  const spinner = ora({
    text: text ?? 'Transferring, please wait...',
    spinner: cliSpinners.material,
  });
  spinner.color = 'yellow';
  return spinner;
}

function splicer(value: string, charsFirst: number = 4, charsEnd: number = 3): string {
  const strinLen = value?.length ?? 0;
  let returnStr = '';
  if ((charsFirst || charsEnd) > strinLen) {
    returnStr = strinLen == 0 ? returnStr : `${value.slice(0, strinLen)}`;
  } else {
    returnStr =
      strinLen == 0 ? returnStr : `${value.slice(0, charsFirst)}..${value.slice(-charsEnd)}`;
  }
  return returnStr;
}
