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


#### Airdrop NFTs

Use this tool to airdrop a specific set of NFTs to holders. You can
Airdrop expects a list of mintids, and then a list of wallets to airdrop the nfts to. You can use the `get-holders-cm` command to get the hashlist. 
The file format to pass as _path to airdrop list_ can be found in `examples/nftdistrolist.json`. This is the only format that will be accepted. 


```sh
npx ts-node src/index.ts airdrop-nft
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
```
#### Airdrop Token per NFTs

Use this command to airdrop a specific SPL-token per NFT.
You can use the `get-holders` command to get the format for the airdrop list. 
Theres also an option to get holders, you have to pass the parameter and the candymachineid (verified creator address).

```sh
npx ts-node src/index.ts airdrop-token <TokenMintId> \
    -e mainnet-beta \
    -k ~/.config/solana/key.json \
    -am 3500 \
    -al <some path> \
    -r  <rpc url>
```

## Upcoming features
- Ability to retry the errors file. 
- Get token info
- Get holders of an spl-token
- UI to make this tool user friendly

## Development

Want to contribute? Great!

Please fork and create a PR for me to review.

Raise an issue with any bugs.

## License

MIT

**Free Software, Hell Yeah!**
