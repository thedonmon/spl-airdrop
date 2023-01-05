#!/usr/bin/env ts-node
import chalk from 'chalk';
import * as figlet from 'figlet';
import log, { LogLevelDesc } from 'loglevel';
import * as fs from 'fs';
import { InvalidArgumentError, program } from 'commander';
import * as spltokenairdrop from './spltokenairdrop';
import {
  elapsed,
  getSnapshot,
  getSnapshotWithMetadata,
  loadWalletKey,
  now,
} from './helpers/utility';
import { HolderAccount } from './types/holderaccounts';
import { getCandyMachineMints } from './helpers/metaplexmint';
import { LogFiles } from './helpers/constants';
import _ from 'lodash';
import {
  Metaplex,
  NftClient,
  Nft,
  keypairIdentity,
  PrintNewEditionInput,
  PublicKey,
} from '@metaplex-foundation/js';
import * as web3Js from '@solana/web3.js';
import * as utility from './helpers/utility';
import { TransactionAudit } from './types/transactionaudit';
import { fetchMintMetdata } from './spltokenairdrop';
import cliSpinners from 'cli-spinners';
import ora from 'ora';
const LOG_PATH = './logs';
const BASE_PATH = __dirname;

program.version('0.0.1').description('A CLI to handle SPL-Token and NFT Airdrops');

log.setLevel(log.levels.INFO);

programCommand('airdrop-token')
  .option('-al, --airdroplist <path>', 'path to list of wallets to airdrop')
  .option('-el, --exclusionlist <path>', 'path to list of wallets to exclude from airdrop')
  .requiredOption(
    '-am, --amount <number>',
    'tokens to airdrop (will be converted to lamports based on mint decimal)',
    myParseInt,
    1,
  )
  .option(
    '-ob, --override-balance-check',
    'send amount regardless of destination wallet balance',
    false,
  )
  .option('-m, --mint-authority', 'mint token to destination if keypair is mintauthority', false)
  .option('-s, --simulate', 'Simulate airdrop', false)
  .option('-b, --batch-size <number>', 'size to batch run txns', myParseInt, 50)
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .action(async (_, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('spl token airdrop', { horizontalLayout: 'controlled smushing' })),
    );
    let start = now();
    clearLogFiles();
    const {
      env,
      keypair,
      airdroplist,
      exclusionlist,
      amount,
      overrideBalanceCheck,
      mintAuthority,
      simulate,
      batchSize,
      rpcUrl,
    } = cmd.opts();
    console.log(cmd.opts());
    let exclusionArr = [];
    if (exclusionlist) {
      exclusionArr = JSON.parse(fs.readFileSync(`${exclusionlist}`, 'utf-8'));
    }
    const kp = loadWalletKey(keypair);
    if (!simulate) {
      await spltokenairdrop.airdropToken({
        keypair: kp,
        whitelistPath: airdroplist,
        transferAmount: amount,
        cluster: env,
        rpcUrl,
        simulate: false,
        batchSize,
        exclusionList: exclusionArr,
        mintIfAuthority: mintAuthority,
        overrideBalanceCheck,
      });
    } else {
      const result = await spltokenairdrop.airdropToken({
        keypair: kp,
        whitelistPath: airdroplist,
        transferAmount: amount,
        cluster: env,
        rpcUrl,
        simulate: true,
        batchSize,
        exclusionList: exclusionArr,
        mintIfAuthority: mintAuthority,
        overrideBalanceCheck,
      });
      log.log(result);
    }
    elapsed(start, true, undefined, true);
  });

programCommand('airdrop-token-per-nft')
  .requiredOption('-am, --amount <number>', 'tokens to airdrop', myParseInt, 1)
  .requiredOption('-d, --decimals <number>', 'Decimals of the SPL token', myParseInt, 9)
  .requiredOption('-m, --mintid <string>', 'Airdrop token MintID')
  .option('-al, --airdroplist <path>', 'path to list of wallets only to airdrop')
  .option('-h, --getholders', 'Take snapshot', false)
  .option('-cm, --verifiedcreator <string>', 'Verified creator address')
  .option('-s, --simulate', 'Simuate airdrop', false)
  .option('-ex, --exclusionlist <path>', 'path to addresses to excluse')
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .option('-b, --batch-size <number>', 'Amount to batch transactions', myParseInt, 25)
  .action(async (_, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('token per nft airdrop', { horizontalLayout: 'controlled smushing' }),
      ),
    );
    let start = now();
    clearLogFiles();
    const {
      keypair,
      env,
      amount,
      decimals,
      mintid,
      airdroplist,
      getHolders,
      verifiedcreator,
      simulate,
      batchSize,
      exclusionlist,
      rpcUrl,
    } = cmd.opts();
    console.log(cmd.opts());
    let holderAccounts: HolderAccount[] = [];
    const kp = loadWalletKey(keypair);
    const mintPk = new PublicKey(mintid);
    if (getHolders) {
      const mints = await getCandyMachineMints(verifiedcreator, env, rpcUrl);
      holderAccounts = await getSnapshot(mints, rpcUrl);
    } else {
      const holders = fs.readFileSync(airdroplist, 'utf8');
      holderAccounts = JSON.parse(holders) as HolderAccount[];
    }
    let exclusionList: string[] = [];
    if (exclusionlist) {
      exclusionList = JSON.parse(fs.readFileSync(exclusionlist, 'utf-8'));
    }
    const result = await spltokenairdrop.airdropTokenPerNft({
      keypair: kp,
      holdersList: holderAccounts,
      tokenMint: mintPk,
      decimals,
      transferAmount: amount,
      cluster: env,
      rpcUrl,
      simulate,
      batchSize,
      exclusionList,
    });
    log.info(result);
    elapsed(start, true, undefined, true);
  });

programCommand('airdrop-nft')
  .requiredOption('-m, --mintIds <path>', 'Mint Ids of NFTs to Send')
  .requiredOption('-al, --airdroplist <path>', 'path to list of wallets to airdrop')
  .option('-s, --simulate', 'Simuate airdrop', false)
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .option('-b, --batch-size <number>', 'Ammount to batch transactions', myParseInt, 5)
  .action(async (_, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('nft airdrop', { horizontalLayout: 'controlled smushing' })),
    );
    let start = now();
    clearLogFiles();
    console.log(cmd.opts());
    const { keypair, env, mintIds, airdroplist, simulate, rpcUrl, batchSize } = cmd.opts();
    const kp = loadWalletKey(keypair);
    if (!simulate) {
      await spltokenairdrop.airdropNft({
        keypair: kp,
        whitelistPath: airdroplist,
        mintlistPath: mintIds,
        cluster: env,
        rpcUrl,
        simulate: false,
        batchSize: batchSize as number,
      });
    } else {
      const result = await spltokenairdrop.airdropNft({
        keypair: kp,
        whitelistPath: airdroplist,
        mintlistPath: mintIds,
        cluster: env,
        rpcUrl,
        simulate: true,
        batchSize: batchSize as number,
      });
      log.log(result);
    }
    elapsed(start, true, undefined, true);
  });

programCommand('retry-errors')
  .option(
    '-ep, --errorsPath <path>',
    'Path to errors JSON file. Will default to errors file path if found',
  )
  .option('-s, --simulate', 'Simuate airdrop', false)
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .option('-b, --batch-size <number>', 'Ammount to batch transactions', myParseInt, 5)
  .action(async (_, cmd) => {
    console.log(
      chalk.red(figlet.textSync('retry errors', { horizontalLayout: 'controlled smushing' })),
    );
    let start = now();
    clearLogFiles(true);
    const { keypair, env, errorsPath, simulate, rpcUrl, batchSize } = cmd.opts();
    const kp = loadWalletKey(keypair);
    let defaultErrorsPath = 'transfererror.json';
    if (errorsPath) {
      defaultErrorsPath = errorsPath;
    }
    if (!simulate) {
      await spltokenairdrop.retryErrors(
        kp,
        defaultErrorsPath,
        env,
        rpcUrl,
        false,
        batchSize as number,
      );
    } else {
      const result = await spltokenairdrop.retryErrors(
        kp,
        defaultErrorsPath,
        env,
        rpcUrl,
        true,
        batchSize as number,
      );
      log.log(result);
    }
    elapsed(start, true, undefined, true);
  });

programCommand('get-holders', { requireWallet: false })
  .argument('<mintIds>', 'MintIds path from candy machine', (val) => {
    return JSON.parse(fs.readFileSync(`${val}`, 'utf-8'));
  })
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .action(async (mintIds: string[], options, cmd) => {
    console.log(cmd);
    console.log(
      chalk.blue(figlet.textSync('get holders', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { env, rpcUrl } = cmd.opts();
    let start = now();
    if (mintIds.length > 0) {
      const result = await getSnapshot(mintIds, rpcUrl);
      var jsonObjs = JSON.stringify(result);
      fs.writeFileSync('holders.json', jsonObjs);
      log.log('Holders written to holders.json');
      log.log(result);
    } else {
      log.log('Please check file is in correct format');
    }
    elapsed(start, true, undefined, true);
  });

programCommand('get-holders-cm', { requireWallet: false })
  .argument('<verifiedCreatorId>', 'Verified Creator Id')
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .action(async (verifiedCreatorId: string, options, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('get holders', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { env, rpcUrl } = cmd.opts();
    let start = now();
    const mintIds = await getCandyMachineMints(verifiedCreatorId, env, rpcUrl);
    if (mintIds) {
      const jsonMints = JSON.stringify(mintIds);
      fs.writeFileSync(`${verifiedCreatorId}-mints.json`, jsonMints);
    }
    const result = await getSnapshot(mintIds, rpcUrl);
    const jsonObjs = JSON.stringify(result);
    fs.writeFileSync('holdersList.json', jsonObjs);
    log.log('Holders written to holders.json');
    log.log(result);
    elapsed(start, true, undefined, true);
  });

programCommand('mint-edition', { requireWallet: true })
  .argument('<mastereditionid>', 'Mint Master Edition Id')
  .option('-al, --airdroplist <path>', 'path to list of wallets only to airdrop')
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .action(async (mastereditionid: string, options, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('print editions', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { keypair, env, rpcUrl, airdroplist } = cmd.opts();
    let start = now();
    const kp = loadWalletKey(keypair);
    const masterEditionId = new PublicKey(mastereditionid);
    const connection =
      rpcUrl != null
        ? new web3Js.Connection(rpcUrl, {
            httpAgent: false,
            commitment: 'confirmed',
          })
        : new web3Js.Connection(web3Js.clusterApiUrl(env as web3Js.Cluster));
    const mp = new Metaplex(connection, {
      cluster: env as web3Js.Cluster,
    }).use(keypairIdentity(kp));
    let wallets: string[] = [];
    if (airdroplist) {
      wallets = JSON.parse(fs.readFileSync(`${airdroplist}`, 'utf-8')) as string[];
      if (wallets?.length <= 0 || wallets == null) {
        log.error('No wallets found in airdrop list');
        return;
      }
    }
    for (let wallet of wallets) {
      if (wallet.includes('.sol')) {
        wallet = await utility.getPublicKeyFromSolDomain(wallet, connection);
      }
      const newMint = web3Js.Keypair.generate();
      const printNewEditionInput: PrintNewEditionInput = {
        originalMint: masterEditionId,
        newOwner: new PublicKey(wallet),
        newMint,
      };
      const NFT = await mp
        .nfts()
        .printNewEdition(printNewEditionInput, {
          commitment: 'confirmed',
          confirmOptions: {
            skipPreflight: true,
          },
        })
        .catch((e) => {
          console.error(e);
        });
      const result = NFT?.editionAddress.toBase58();
      const jsonObjs = JSON.stringify(result);
      console.log(`${wallet} receieved edition ${result}`);
    }

    elapsed(start, true, undefined, true);
  });

programCommand('get-mints-cmid', { requireWallet: false })
  .argument('<candymachineid>', 'Candy Machine Id')
  .option('-v, --version <number>', 'candy machine version (default 2)', myParseInt, 2)
  .option('-h, --holders', 'get holders list', false)
  .option('-m, --include-metadata', 'include metadata info about NFT', false)
  .option('-f, --filter-mktp', 'filter out known mktplaces', false)
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .action(async (candymachineid: string, options, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('get mints', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { env, version, holders, includeMetadata, rpcUrl, filterMktp } = cmd.opts();
    let start = now();
    const spinner = getSpinner();
    spinner.start();
    const connection =
      rpcUrl != null
        ? new web3Js.Connection(rpcUrl, {
            httpAgent: false,
            commitment: 'confirmed',
          })
        : new web3Js.Connection(web3Js.clusterApiUrl(env as web3Js.Cluster));
    const mp = new Metaplex(connection, {
      cluster: env as web3Js.Cluster,
    });
    const candyMachinePk = new web3Js.PublicKey(candymachineid);
    const mints = await mp
      .candyMachinesV2()
      .findMintedNfts({ candyMachine: candyMachinePk, version });
    if (mints) {
      const mintData = includeMetadata
        ? mints.map((x) => {
            return {
              mint:
                x.model == 'metadata'
                  ? (x as any)['mintAddress'].toBase58()
                  : x.mint.address.toBase58(),
              name: x.name,
              uri: x.uri,
            };
          })
        : mints.map((x) =>
            x.model == 'metadata'
              ? (x as any)['mintAddress'].toBase58()
              : x.mint.address.toBase58(),
          );
      const jsonMints = JSON.stringify(mintData);
      fs.writeFileSync(`${candymachineid}-mints.json`, jsonMints);
      if (holders) {
        const result = includeMetadata
          ? await getSnapshotWithMetadata(mints as Nft[], rpcUrl, filterMktp)
          : await getSnapshot(mintData as string[], rpcUrl, filterMktp);
        const jsonObjs = JSON.stringify(result);
        fs.writeFileSync('holdersList.json', jsonObjs);
        log.log('Holders written to holders.json');
        log.log(result);
      }
    } else {
      log.error('No mints found...');
    }
    spinner.stop();
    elapsed(start, true, undefined, true);
  });

  programCommand('get-mints-ua', { requireWallet: false })
  .argument('<updateauthority>', 'update authority')
  .option('-h, --holders', 'get holders list', false)
  .option('-m, --include-metadata', 'include metadata info about NFT', false)
  .option('-f, --filter-mktp', 'filter out known mktplaces', false)
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .action(async (updateauthority: string, options, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('get mints', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { env, holders, includeMetadata, rpcUrl, filterMktp } = cmd.opts();
    let start = now();
    const spinner = getSpinner();
    spinner.start();
    const connection =
      rpcUrl != null
        ? new web3Js.Connection(rpcUrl, {
            httpAgent: false,
            commitment: 'confirmed',
          })
        : new web3Js.Connection(web3Js.clusterApiUrl(env as web3Js.Cluster));
    const mp = new Metaplex(connection, {
      cluster: env as web3Js.Cluster,
    });
    const updateAuthority = new web3Js.PublicKey(updateauthority);
    const mints = await mp
      .nfts()
      .findAllByUpdateAuthority({ updateAuthority: updateAuthority });
    if (mints) {
      const mintData = includeMetadata
        ? mints.map((x) => {
            return {
              mint:
                x.model == 'metadata'
                  ? (x as any)['mintAddress'].toBase58()
                  : x.mint.address.toBase58(),
              name: x.name,
              uri: x.uri,
            };
          })
        : mints.map((x) =>
            x.model == 'metadata'
              ? (x as any)['mintAddress'].toBase58()
              : x.mint.address.toBase58(),
          );
      const jsonMints = JSON.stringify(mintData);
      fs.writeFileSync(`${updateauthority}-mints.json`, jsonMints);
      if (holders) {
        const result = includeMetadata
          ? await getSnapshotWithMetadata(mints as Nft[], rpcUrl, filterMktp)
          : await getSnapshot(mintData as string[], rpcUrl, filterMktp);
        const jsonObjs = JSON.stringify(result);
        fs.writeFileSync('holdersList.json', jsonObjs);
        log.log('Holders written to holders.json');
        log.log(result);
      }
    } else {
      log.error('No mints found...');
    }
    spinner.stop();
    elapsed(start, true, undefined, true);
  });

programCommand('get-mints-creator', { requireWallet: false })
  .argument('<actualCreatorId>', 'Creator Id')
  .option(
    '-p, --creatorPosition <number>',
    'position in creators array (zero based indexing)',
    myParseInt,
    0,
  )
  .option('-h, --holders', 'get holders list', false)
  .option('-m, --include-metadata <boolean>', 'include metadata info about NFT', false)
  .option('-f, --filter-mktp', 'filter out known mktplaces', false)
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .action(async (actualCreatorId: string, options, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('get mints', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { env, creatorPosition, holders, includeMetadata, rpcUrl, filterMktp } = cmd.opts();
    let start = now();
    const spinner = getSpinner();
    spinner.start();
    const connection =
      rpcUrl != null
        ? new web3Js.Connection(rpcUrl, {
            httpAgent: false,
            commitment: 'confirmed',
          })
        : new web3Js.Connection(web3Js.clusterApiUrl(env as web3Js.Cluster));
    const mp = Metaplex.make(connection);
    const candyMachinePk = new web3Js.PublicKey(actualCreatorId);
    try {
      const mints = await mp
        .nfts()
        .findAllByCreator({ creator: candyMachinePk, position: creatorPosition });
      if (mints) {
        console.log('MINTS>>>', mints);
        const mintData = includeMetadata
          ? mints.map((x) => {
              return {
                mint:
                  x.model == 'metadata'
                    ? (x as any)['mintAddress'].toBase58()
                    : x.mint.address.toBase58(),
                name: x.name,
                uri: x.uri,
              };
            })
          : mints.map((x) =>
              x.model == 'metadata'
                ? (x as any)['mintAddress'].toBase58()
                : x.mint.address.toBase58(),
            );
        const jsonMints = JSON.stringify(mintData);
        fs.writeFileSync(`${actualCreatorId}-mints.json`, jsonMints);
        if (holders) {
          const result = includeMetadata
            ? await getSnapshotWithMetadata(mints as Nft[], rpcUrl, filterMktp)
            : await getSnapshot(mintData as string[], rpcUrl, filterMktp);
          const jsonObjs = JSON.stringify(result);
          fs.writeFileSync('holdersList.json', jsonObjs);
          log.log('Holders written to holders.json');
          log.log(result);
        }
        spinner.succeed();
      } else {
        log.error('No mints found...');
        spinner.fail('No mints found...');
      }
    } catch (e) {
      spinner.fail('Error getting mints');
      console.log('ERROR', e);
    }
    spinner.stop();
    elapsed(start, true, undefined, true);
  });

programCommand('get-mints-wallet', { requireWallet: false })
  .argument('<wallet>', 'wallet')
  .option('-co, --collection <string>', 'certified collection address')
  .option('-m, --include-metadata', 'include metadata info about NFT', false)
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .action(async (wallet: string, options, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('get wallet mints', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { env, includeMetadata, rpcUrl, collection } = cmd.opts();
    console.log(cmd.opts());
    let start = now();
    const spinner = getSpinner();
    spinner.start();
    const connection =
      rpcUrl != null
        ? new web3Js.Connection(rpcUrl, {
            httpAgent: false,
            commitment: 'confirmed',
          })
        : new web3Js.Connection(web3Js.clusterApiUrl(env as web3Js.Cluster));
    const mp = new Metaplex(connection, {
      cluster: env as web3Js.Cluster,
    });
    const walletPk = new web3Js.PublicKey(wallet);
    const nftClient = new NftClient(mp);
    const mints = await nftClient.findAllByOwner({ owner: walletPk });
    if (mints) {
      const mintData = includeMetadata
        ? collection
          ? mints
              .filter((m) => m?.collection?.address.toBase58() == collection)
              .map((x) => {
                return {
                  mint:
                    x.model == 'metadata'
                      ? (x as any)['mintAddress'].toBase58()
                      : x.mint.address.toBase58(),
                  name: x.name,
                  image: x.jsonLoaded ? x.json?.image : '',
                  attributes: x.jsonLoaded ? x.json?.attributes : {},
                };
              })
          : mints.map((x) => {
              return {
                mint:
                  x.model == 'metadata'
                    ? (x as any)['mintAddress'].toBase58()
                    : x.mint.address.toBase58(),
                name: x.name,
                image: x.jsonLoaded ? x.json?.image : '',
                attributes: x.jsonLoaded ? x.json?.attributes : {},
              };
            })
        : collection
        ? mints
            .filter((m) => m.collection?.address.toBase58() === collection)
            .map((x) => {
              return (x as any)['mintAddress'].toBase58();
            })
        : mints.map((x) => (x as any)['mintAddress'].toBase58());
      const jsonMints = JSON.stringify(mintData);
      fs.writeFileSync(`${wallet}-mints.json`, jsonMints);
      spinner.succeed();
    } else {
      log.error('No mints found...');
    }
    spinner.stop();
    elapsed(start, true, undefined, true);
  });

programCommand('fetch-mint-metadata', { requireWallet: false })
  .argument('<mints>', 'mints')
  .option('-m, --include-metadata', 'include metadata info about NFT', false)
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .option('-b, --batch-size <number>', 'size to batch run', myParseInt, 100)
  .action(async (mints: string, options, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('get mints metadata', { horizontalLayout: 'controlled smushing' }),
      ),
    );
    clearLogFiles();
    const { env, includeMetadata, rpcUrl, batchSize } = cmd.opts();
    console.log(cmd.opts());
    let start = now();
    const connection =
      rpcUrl != null
        ? new web3Js.Connection(rpcUrl, {
            httpAgent: false,
            commitment: 'confirmed',
          })
        : new web3Js.Connection(web3Js.clusterApiUrl(env as web3Js.Cluster));
    const mp = new Metaplex(connection, {
      cluster: env as web3Js.Cluster,
    });
    const mintList = JSON.parse(fs.readFileSync(mints, 'utf8')) as string[];
    if (!mintList) {
      log.error('Mint list not in correct format. Make sure it is a list of mint ids');
      return;
    }
    await fetchMintMetdata(mintList, mp, includeMetadata, batchSize);

    elapsed(start, true, undefined, true);
  });

programCommand('format-snapshot', { requireWallet: false })
  .argument('<snapshot>', 'snapshot path')
  .action(async (snapshot: string, _, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('format snapshhot', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    let start = now();
    const holders = spltokenairdrop.formatHoldersList(snapshot);
    const holdersStr = JSON.stringify(holders);
    fs.writeFileSync('holdersList.json', holdersStr);
    log.log('Holders written to holders.json');
    elapsed(start, true);
  });

programCommand('format-holderlist-to-wallets', { requireWallet: false })
  .argument('<holderlist>', 'holderlist path')
  .action(async (holderlist: string, _, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('format snapshhot', { horizontalLayout: 'controlled smushing' })),
    );
    let start = now();
    const wallets = spltokenairdrop.formatFromHolderListToWalletList(holderlist);
    const walletsStr = JSON.stringify(wallets);
    fs.writeFileSync('wallets.json', walletsStr);
    log.log('Wallets written to wallets.json');
    elapsed(start, true, undefined, true);
  });

programCommand('format-snapshot-to-wallets-permint', { requireWallet: false })
  .argument('<snapshot>', 'snapshot path')
  .option('-rn, --random', 'randomize per mint true or false', false)
  .option('-f, --filtermp', 'filter marketplace true or false', false)
  .action(async (snapshot: string, _, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('format snapshhot', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    let start = now();
    console.log(cmd.opts());
    const { random, filtermp } = cmd.opts();
    const wallets = spltokenairdrop.formatHoldersToWallet(snapshot, true, random, filtermp);
    const walletsStr = JSON.stringify(wallets);
    fs.writeFileSync('walletsPerMint.json', walletsStr);
    log.log('Wallets written to wallets.json');
    elapsed(start, true, undefined, true);
  });

programCommand('download-images', { requireWallet: false })
  .argument('<snapshot>', 'snapshot path')
  .action(async (snapshot: string, _, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('format snapshhot', { horizontalLayout: 'controlled smushing' })),
    );
    let start = now();

    const wallets = await spltokenairdrop.downloadMintImages(snapshot);
    elapsed(start, true, undefined, true);
  });

programCommand('exclude-address', { requireWallet: false })
  .argument('<transactions>', 'transactions path')
  .option('-r, --rpc-url <string>', 'custom rpc url since this is a heavy command')
  .action(async (transactions: string, _, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('get txn info', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { env, rpcUrl } = cmd.opts();
    let start = now();
    const stringData = fs.readFileSync(transactions, 'utf-8');
    const jsonData = JSON.parse(stringData) as any;
    const exclusions = await spltokenairdrop.getTransferTransactionInfo(jsonData, env, rpcUrl);
    const exclusionstr = JSON.stringify(exclusions);
    fs.writeFileSync('exclusionlist.json', exclusionstr);
    log.log('excluded accounts written to exclusionlist.json');
    elapsed(start, true, undefined, true);
  });

programCommand('get-count', { requireWallet: false })
  .argument('<transactions>', 'transactions path')
  .action(async (transactions: string, _, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('get txn info', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { env, rpcUrl } = cmd.opts();
    let start = now();
    const stringData = fs.readFileSync(transactions, 'utf-8');
    const jsonData = JSON.parse(stringData) as any[];
    console.log(jsonData);
    const sum = utility.calculateSum(jsonData, 'nFtsToAirdrop');
    console.log('total: ', sum);
    elapsed(start, true, undefined, true);
  });

programCommand('format-mint-drop', { requireWallet: false })
  .argument('<snapshot>', 'snapshot path')
  .requiredOption('-a, --amount <number>', 'Multipler for the amount of nfts to drop')
  .action(async (snapshot: string, _, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('format mint drop', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { amount } = cmd.opts();
    let start = now();
    const stringData = fs.readFileSync(snapshot, 'utf-8');
    const jsonData = JSON.parse(stringData) as any;
    const holders = spltokenairdrop.formatNftDropByWalletMultiplier(jsonData, amount as number);
    const holdersStr = JSON.stringify(holders);
    fs.writeFileSync('nfttransfer.json', holdersStr);
    log.log('Holders written to holders.json');
    elapsed(start, true, undefined, true);
  });

programCommand('parse-txns', { requireWallet: false })
  .argument('<snapshot>', 'snapshot path')
  .action(async (snapshot: string, _, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('format mint drop', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { env, rpcUrl } = cmd.opts();
    let start = now();
    const stringData = fs.readFileSync(snapshot, 'utf-8');
    const jsonData = JSON.parse(stringData) as any;
    const holders = spltokenairdrop.parseTransactions(jsonData as TransactionAudit[], env, rpcUrl);
    const holdersStr = JSON.stringify(holders);
    fs.writeFileSync('nfttransfer.json', holdersStr);
    log.log('Holders written to holders.json');
    elapsed(start, true, undefined, true);
  });

programCommand('format-mint-drop', { requireWallet: false })
  .argument('<snapshot>', 'snapshot path')
  .requiredOption('-a, --amount <number>', 'Amount of NFTs per mint')
  .action(async (snapshot: string, _, cmd) => {
    console.log(
      chalk.blue(figlet.textSync('format mint drop', { horizontalLayout: 'controlled smushing' })),
    );
    clearLogFiles();
    const { amount } = cmd.opts();
    let start = now();
    const stringData = fs.readFileSync(snapshot, 'utf-8');
    const jsonData = JSON.parse(stringData) as any;
    const holders = spltokenairdrop.formatNftDropByWallet(jsonData, amount as number);
    const holdersStr = JSON.stringify(holders);
    fs.writeFileSync('mintransfer.json', holdersStr);
    log.log('Holders written to holders.json');
    elapsed(start, true, undefined, true);
  });
// From commander examples
function myParseInt(value: any) {
  // parseInt takes a string and a radix
  const parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue)) {
    throw new InvalidArgumentError('Not a number.');
  }
  return parsedValue;
}

if (!fs.existsSync(LOG_PATH)) {
  fs.mkdirSync(LOG_PATH);
}

if (!fs.existsSync(LOG_PATH)) {
  fs.mkdirSync(LOG_PATH);
}

function programCommand(
  name: string,
  options: { requireWallet: boolean } = { requireWallet: true },
) {
  let cmProgram = program
    .command(name)
    .option(
      '-e, --env <string>',
      'Solana cluster env name',
      'devnet', //mainnet-beta, testnet, devnet
    )
    .option('-l, --log-level <string>', 'log level', setLogLevel, 'INFO')
    .option('-c, --cache-name <string>', 'Cache file name', 'temp');

  if (options.requireWallet) {
    cmProgram = cmProgram.requiredOption('-k, --keypair <path>', `Solana wallet location`);
  }

  return cmProgram;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function setLogLevel(value: any, prev: any) {
  let parsed = value as LogLevelDesc;
  if (value === undefined || value === null) {
    parsed = 'INFO';
  }
  log.setLevel(parsed);
  return parsed;
}

function clearLogFiles(isRetry: boolean = false) {
  overwriteFileIfNotExists(LogFiles.TransferNftTxt);
  overwriteFileIfNotExists(LogFiles.TransferNftErrorsTxt);
  overwriteFileIfNotExists(LogFiles.TokenTransferTxt);
  overwriteFileIfNotExists(LogFiles.TokenTransferErrorsTxt);
  overwriteFileIfNotExists(LogFiles.TokenTransferNftTxt);
  overwriteFileIfNotExists(LogFiles.TokenTransferNftErrorsTxt);
  overwriteFileIfNotExists(LogFiles.RetryTransferErrorTxt);
  if (!isRetry) {
    overwriteFileIfNotExists(LogFiles.TransferErrorJson, true);
    overwriteFileIfNotExists(LogFiles.RetryTransferErrorJson, true);
  }
}

function getSpinner(text?: string, color?: ora.Color): ora.Ora {
  const spinner = ora({
    text: text ? text : 'Calling rpc to get mints, please wait',
    spinner: cliSpinners.material,
  });
  spinner.color = color ? color : 'yellow';
  return spinner;
}

function overwriteFileIfNotExists(fileName: string, isJson: boolean = false) {
  if (!fs.existsSync(fileName)) {
    isJson
      ? fs.writeFileSync(fileName, JSON.stringify([]), { flag: 'w' })
      : fs.writeFileSync(fileName, '', { flag: 'w' });
  } else {
    isJson
      ? fs.writeFileSync(fileName, JSON.stringify([]), { flag: 'w' })
      : fs.writeFileSync(fileName, '', { flag: 'w' });
  }
}

program.parse(process.argv);
