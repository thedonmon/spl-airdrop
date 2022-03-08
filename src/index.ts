#!/usr/bin/env ts-node
import chalk from 'chalk';
import * as figlet from 'figlet';
import log from 'loglevel';
import * as path from 'path';
import * as fs from 'fs';
import { InvalidArgumentError, program } from 'commander';
const CACHE_PATH = './.cache';

program
  .version('0.0.1')
  .description("A CLI to handle SPL-Token and NFT Airdrops");
// From commander examples

log.setLevel(log.levels.INFO);


programCommand('simulate-airdrop')
  .argument('<mint-tokenId>', 'MintID')
  .option('-al <path>, --airdroplist', 'path to list of wallets to airdrop')
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .action(async (candyMachineId, _, cmd) => {
    console.log(
      chalk.blue(
        figlet.textSync('simulate airdrop', { horizontalLayout: 'controlled smushing' })
      )
    );
    const { keypair, env, dry, charity, charityPercent, rpcUrl } = cmd.opts();
  });

function myParseInt(value: any) {
  // parseInt takes a string and a radix
  const parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue)) {
    throw new InvalidArgumentError('Not a number.');
  }
  return parsedValue;
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
    .option('-l, --log-level <string>', 'log level', setLogLevel)
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
  if (value === undefined || value === null) {
    return;
  }
  log.info('setting the log value to: ' + value);
  log.setLevel(value);
}
program.parse(process.argv);