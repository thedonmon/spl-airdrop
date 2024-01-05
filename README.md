# Token Airdrop Tool

## _The one stop shop for token needs_

If you enjoy using this tool send the creator a tip!

- SOL: MaMaNNgYTNqLzt6CZHzvhropNVqv6NwKo4JJQQt5BzP
- ETH: maman.eth

## Features

- Airdrop Whitelist tokens given a list of wallet addresses (whitelist)
- Airdrop NFTs to list of holders
- Airdrop SPL-tokens based on holdings
- Get snapshot
- Get hash list
- Format files to spec based on actions taken (transfer nfts, airdrop tokens, etc.)
- Retry errors for both types of transfers in one command.
- **Update 01-04-2024**: Helius functionality for snapshots and transaction parsing - more tooling in progress

## Installation

Airdrop tool requires [Node.js](https://nodejs.org/) v10+ to run.

```sh
git clone https://github.com/thedonmon/spl-airdrop.git
```

Install the dependencies and devDependencies and follow instructions below.

```sh
cd spl-airdrop
yarn install
```

The airdrop tool is quite resource intensive on the solana RPC so using a custom RPC url is strongly recommeneded. You can get a RPC over at [Quicknode](https://www.quicknode.com/pricing) without ratelmiting for $99/month

#### Airdrop NFTs / Bulk Transfer NFTs.

Use this tool to airdrop a specific set of NFTs to holders. You can
Airdrop expects a list of mintids, and then a list of wallets to airdrop the nfts to. You can use the `get-holders-cm` command to get the hashlist. This will generate a hashlist for you.
The file format to pass as _path to airdrop list_ can be found in `examples/nftdistrolist.json`. This is the only format that will be accepted. Use this file to add the wallet and how many NFTs from the hashlist generated a wallet should receive. If you would like to mass send NFTs from a wallet you own, get the holders snapshot and get the mint ids from your wallet or pass the list of mint ids and only specify the address you are trying to send to in the same format as `nftdistrolist.json`.

```sh
npx ts-node src/index.ts airdrop-nft \
    -m <path to mint ids> \
    -al <path to airdrop list> \
    -e mainnet-beta \
    -k ~/.config/solana/wallet.json \
    -r  <rpcurl> \
    -l trace
```

#### Airdrop Whitelist tokens

Use this command to airdrop your WL tokens or any SPL token to a list of addresses. Please format the airdrop list the exact same way as `examples/whitelist.json` Reference the type `whitelist.ts`.

```sh
npx ts-node src/index.ts airdrop-token \
    -e mainnet-beta \
    -k ~/.config/solana/key.json \
    -am 1 \
    -al <some path> \
    -r  <rpc url>
    -m <mint to destination wallet if present will be true>
    -ob <do not validate token balance of destination wallet>
```

#### Airdrop Token per NFTs

Use this command to airdrop a specific SPL-token per NFT.
You can use the `get-holders` command to get the format for the airdrop list.
Theres also an option to get holders, you have to pass the parameter and the candymachineid (verified creator address).

```sh
npx ts-node src/index.ts airdrop-token-per-nft \
    -m <TokenMintId>
    -d 9
    -e mainnet-beta \
    -k ~/.config/solana/key.json \
    -am 3500 \
    -al <some path> \
    -r  <rpc url>
```

#### Retry Errors

Use this command to retry any failed transfers.
For each command above, all errors are formatted and appended to a `transfererrors.json` file. If anything from these fail, another file `rety-transfer-errors.json` is generated. Files can be found in the `logs/` folder. If no path is specified, defaults to the `transfererror.json` file. All logs will be cleaned up per command execution. When you run a retry command however, the transfererror file and retryerrorfiles are not overwritten. It is highly recommended you copy these files to a different location manually and pass the path as an argument, esepcially running this command multiple times. That way each retry-error and transfererror file will be unique to that command session.

```sh
npx ts-node src/index.ts retry-errors \
    -ep <error-file path> \
    -e mainnet-beta \
    -k ~/.config/solana/key.json \
    -b 100 \
    -r  <rpc url>
```

## Upcoming features

- [ ] UI to make this tool user friendly

## Development

Want to contribute? Great!

Thank you for your interest in contributing to this tool! All contributions are welcome no matter how big or small. This includes (but is not limited to) filing issues, adding documentation, fixing bugs, creating examples, and implementing features.

If you'd like to contribute, please claim an issue by commenting, forking, and opening a pull request, even if empty. This allows the maintainers to track who is working on what issue as to not overlap work.

For simple documentation changes, feel free to just open a pull request.

Raise an issue with any bugs.

## License

MIT

**Free Software, Hell Yeah!**
