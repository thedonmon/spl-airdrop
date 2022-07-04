#!/usr/bin/env ts-node
import chalk from 'chalk';
import * as figlet from 'figlet';
import log, { LogLevelDesc } from 'loglevel';
import * as fs from 'fs';
import { InvalidArgumentError, program } from 'commander';
import * as spltokenairdrop from './spltokenairdrop';
import { elapsed, getSnapshot, loadWalletKey, now } from './helpers/utility';
import { PublicKey } from '@solana/web3.js';
import { HolderAccount } from './types/holderaccounts';
import { getCandyMachineMints } from './helpers/metaplexmint';
import { LogFiles } from './helpers/constants';
import _ from 'lodash';

const CACHE_PATH = './.cache';

program
  .version('0.0.1')
  .description("A CLI to handle SPL-Token and NFT Airdrops");

log.setLevel(log.levels.INFO);

programCommand('airdrop-token')
  .option('-al, --airdroplist <path>', 'path to list of wallets to airdrop')
  .option('-el, --exclusionlist <path>', 'path to list of wallets to exclude from airdrop')
  .requiredOption('-am, --amount <number>', 'tokens to airdrop (will be converted to lamports based on mint decimal)', myParseInt, 1)
  .option('-ob, --override-balance-check <boolean>', 'send amount regardless of destination wallet balance', myParseBool, false)
  .option('-m, --mint-authority <boolean>', 'mint token to destination if keypair is mintauthority', myParseBool, true)
  .option('-s, --simulate', 'Simulate airdrop')
  .option('-b, --batch-size <number>', 'size to batch run txns', myParseInt, 50)
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .action(async (_, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('spl token airdrop', { horizontalLayout: 'controlled smushing' })
      )
    );
    let start = now();
    clearLogFiles();
    const { env, keypair, airdroplist, exclusionlist, amount, overrideBalanceCheck, mintAuthority, simulate, batchSize, rpcUrl } = cmd.opts();
    let exclusionArr = [];
    if (exclusionlist) {
      exclusionArr = JSON.parse(fs.readFileSync(`${exclusionlist}`, 'utf-8'));
    }
    const kp = loadWalletKey(keypair);
    if (!simulate) {
      await spltokenairdrop.airdropToken(kp, airdroplist, amount, env, rpcUrl, false, batchSize, exclusionArr, mintAuthority, overrideBalanceCheck);
    }
    else {
      const result = await spltokenairdrop.airdropToken(kp, airdroplist, amount, env, rpcUrl, true, batchSize, exclusionArr, mintAuthority, overrideBalanceCheck);
      log.log(result);
    }
    elapsed(start, true);
  });

programCommand('airdrop-token-per-nft')
  .requiredOption('-am, --amount <number>', 'tokens to airdrop', myParseInt, 1)
  .requiredOption('-d, --decimals <number>', 'Decimals of the SPL token', myParseInt, 9)
  .requiredOption('-m, --mintid <string>', 'Airdrop token MintID')
  .option('-al, --airdroplist <path>', 'path to list of wallets only to airdrop')
  .option('-h, --getholders <boolean>', 'Take snapshot', false)
  .option('-cm, --verifiedcreator <string>', 'Verified creator address')
  .option('-s, --simulate', 'Simuate airdrop')
  .option('-ex, --exclusionlist <path>', 'path to addresses to excluse')
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .option('-b, --batch-size <number>', 'Amount to batch transactions', '25')
  .action(async (_, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('token per nft airdrop', { horizontalLayout: 'controlled smushing' })
      )
    );
    let start = now();
    clearLogFiles();
    const { keypair, env, amount, decimals, mintid, airdroplist, getHolders, verifiedcreator, simulate, batchSize, exclusionlist, rpcUrl } = cmd.opts();
    console.log(cmd.opts());
    let holderAccounts: HolderAccount[] = [];
    const kp = loadWalletKey(keypair);
    const mintPk = new PublicKey(mintid);
    if (getHolders) {
      const mints = await getCandyMachineMints(verifiedcreator, env, rpcUrl);
      holderAccounts = await getSnapshot(mints, rpcUrl);
    }
    else {
      const holders = fs.readFileSync(airdroplist, 'utf8');
      holderAccounts = JSON.parse(holders) as HolderAccount[];
    }
    let exclusionList: string[] = [];
    if (exclusionlist) {
      exclusionList = JSON.parse(fs.readFileSync(exclusionlist, 'utf-8'));
    }
    const result = await spltokenairdrop.airdropTokenPerNft(kp, holderAccounts, mintPk, decimals, amount, env, rpcUrl, simulate, batchSize, exclusionList);
    log.info(result);
    elapsed(start, true);
  });


programCommand('airdrop-nft')
  .requiredOption('-m, --mintIds <path>', 'Mint Ids of NFTs to Send')
  .requiredOption('-al, --airdroplist <path>', 'path to list of wallets to airdrop')
  .option('-s, --simulate <boolean>', 'Simuate airdrop')
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .option('-b, --batch-size <number>', 'Ammount to batch transactions', '5')
  .action(async (_, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('nft airdrop', { horizontalLayout: 'controlled smushing' })
      )
    );
    let start = now();
    clearLogFiles();
    const { keypair, env, mintIds, airdroplist, simulate, rpcUrl, batchSize } = cmd.opts();
    console.log(cmd.opts());
    const kp = loadWalletKey(keypair);
    if (!simulate) {
      await spltokenairdrop.airdropNft(kp, airdroplist, mintIds, env, rpcUrl, false, batchSize as number);

    }
    else {
      const result = await spltokenairdrop.airdropNft(kp, airdroplist, mintIds, env, rpcUrl, true, batchSize as number);
      log.log(result);
    }
    elapsed(start, true);
  });

programCommand('retry-errors')
  .option('-ep, --errorsPath <path>', 'Path to errors JSON file. Will default to errors file path if found')
  .option('-s, --simulate <boolean>', 'Simuate airdrop')
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .option('-b, --batch-size <number>', 'Ammount to batch transactions', '5')
  .action(async (_, cmd) => {
    console.log(
      chalk.red(
        figlet.textSync('retry errors', { horizontalLayout: 'controlled smushing' })
      )
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

      await spltokenairdrop.retryErrors(kp, defaultErrorsPath, env, rpcUrl, false, batchSize as number);

    }
    else {
      const result = await spltokenairdrop.retryErrors(kp, defaultErrorsPath, env, rpcUrl, true, batchSize as number);
      log.log(result);
    }
    elapsed(start, true);
  });


programCommand('get-holders', { requireWallet: false })
  .argument('<mintIds>', 'MintIds path from candy machine', val => {
    return JSON.parse(fs.readFileSync(`${val}`, 'utf-8'));
  })
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .action(async (mintIds: string[], options, cmd) => {
    console.log(cmd);
    console.log(
      chalk.blue(
        figlet.textSync('get holders', { horizontalLayout: 'controlled smushing' })
      )
    );
    const { env, rpcUrl } = cmd.opts();
    let start = now();
    if (mintIds.length > 0) {
      const result = await getSnapshot(mintIds, rpcUrl);
      var jsonObjs = JSON.stringify(result);
      fs.writeFileSync('holders.json', jsonObjs);
      log.log('Holders written to holders.json');
      log.log(result);
    }
    else {
      log.log('Please check file is in correct format');
    }
    elapsed(start, true);
  });

programCommand('get-holders-cm', { requireWallet: false })
  .argument('<verifiedCreatorId>', 'Verified Creator Id')
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .action(async (verifiedCreatorId: string, options, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('get holders', { horizontalLayout: 'controlled smushing' })
      )
    );
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
    elapsed(start, true);
  });

programCommand('format-snapshot', { requireWallet: false })
  .argument('<snapshot>', 'snapshot path')
  .action(async (snapshot: string, _, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('format snapshhot', { horizontalLayout: 'controlled smushing' })
      )
    );
    let start = now();
    const holders = spltokenairdrop.formatHoldersList(snapshot);
    const holdersStr = JSON.stringify(holders);
    fs.writeFileSync('holdersList.json', holdersStr);
    log.log('Holders written to holders.json');
    elapsed(start, true);
  });

programCommand('format-snapshot-to-wallets', { requireWallet: false })
  .argument('<snapshot>', 'snapshot path')
  .action(async (snapshot: string, _, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('format snapshhot', { horizontalLayout: 'controlled smushing' })
      )
    );
    let start = now();
    const wallets = spltokenairdrop.formatWalletList(snapshot);
    const walletsStr = JSON.stringify(wallets);
    fs.writeFileSync('wallets.json', walletsStr);
    log.log('Wallets written to wallets.json');
    elapsed(start, true);
  });

programCommand('exclude-address', { requireWallet: false })
  .argument('<transactions>', 'transactions path')
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .action(async (transactions: string, _, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('get txn info', { horizontalLayout: 'controlled smushing' })
      )
    );
    const { env, rpcUrl } = cmd.opts();
    let start = now();
    const stringData = fs.readFileSync(transactions, 'utf-8');
    const jsonData = JSON.parse(stringData) as any;
    const exclusions = await spltokenairdrop.getTransferTransactionInfo(jsonData, env, rpcUrl);
    const exclusionstr = JSON.stringify(exclusions);
    fs.writeFileSync('exclusionlist.json', exclusionstr);
    log.log('excluded accounts written to exclusionlist.json');
    elapsed(start, true);
  });



programCommand('format-mint-drop', { requireWallet: false })
  .argument('<snapshot>', 'snapshot path')
  .requiredOption('-a, --amount <number>', 'Amount of NFTs per mint')
  .action(async (snapshot: string, _, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('format mint drop', { horizontalLayout: 'controlled smushing' })
      )
    );
    const { amount } = cmd.opts();
    let start = now();
    const stringData = fs.readFileSync(snapshot, 'utf-8');
    const jsonData = JSON.parse(stringData) as any;
    const holders = spltokenairdrop.formatNftDropByWallet(jsonData, amount as number);
    const holdersStr = JSON.stringify(holders);
    fs.writeFileSync('mintransfer.json', holdersStr);
    log.log('Holders written to holders.json');
    elapsed(start, true);
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

function myParseBool(value: any) {
  try {
    const parsedValue = JSON.parse(value);
    if (!_.isBoolean(parsedValue)) {
      throw new InvalidArgumentError('Not a boolean.');
    }
    return parsedValue;
  }
  catch (e) {
    throw new InvalidArgumentError(`Not a boolean. ${value}`);
  }
}

if (!fs.existsSync(CACHE_PATH)) {
  fs.mkdirSync(CACHE_PATH);
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
    cmProgram = cmProgram.requiredOption(
      '-k, --keypair <path>',
      `Solana wallet location`,
    );
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
  fs.writeFileSync(LogFiles.TransferNftTxt, '');
  fs.writeFileSync(LogFiles.TransferNftErrorsTxt, '');
  fs.writeFileSync(LogFiles.TokenTransferTxt, '');
  fs.writeFileSync(LogFiles.TokenTransferErrorsTxt, '');
  fs.writeFileSync(LogFiles.TokenTransferNftTxt, '');
  fs.writeFileSync(LogFiles.TokenTransferNftErrorsTxt, '');
  fs.writeFileSync(LogFiles.RetryTransferErrorTxt, '');
  if (!isRetry) {
    fs.writeFileSync(LogFiles.TransferErrorJson, JSON.stringify([]));
    fs.writeFileSync(LogFiles.RetryTransferErrorJson, JSON.stringify([]));
  }
}

program.parse(process.argv);