import * as web3Js from '@solana/web3.js';
import log from 'loglevel';
import cliSpinners from 'cli-spinners';
import ora from 'ora';
import { decodeMetadata, Metadata } from './metaplexschema';

export type AccountAndPubkey = {
    pubkey: string;
    account: web3Js.AccountInfo<Buffer>;
};

const MAX_NAME_LENGTH = 32;
const MAX_URI_LENGTH = 200;
const MAX_SYMBOL_LENGTH = 10;
const MAX_CREATOR_LEN = 32 + 1 + 1;
const TOKEN_METADATA_PROGRAM = new web3Js.PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const CANDY_MACHINE_V2_PROGRAM = new web3Js.PublicKey('cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ');

async function getCandyMachineCreator(candyMachine: web3Js.PublicKey): Promise<[web3Js.PublicKey, number]> {
    const creatorTuple = web3Js.PublicKey.findProgramAddress(
        [Buffer.from('candy_machine'), candyMachine.toBuffer()],
        CANDY_MACHINE_V2_PROGRAM,
    )
    return creatorTuple;
}

export async function getCandyMachineMints(candyMachineId: string, env: string = 'mainnet-beta', rpcUrl: string | null = null): Promise<string[]> {
    const connection = rpcUrl != null ? new web3Js.Connection(rpcUrl) : new web3Js.Connection('https://ssc-dao.genesysgo.net');
    const candyMachinePk = new web3Js.PublicKey(candyMachineId);
    log.info(`Getting mints for candy machine ${candyMachineId}`);
    const candyMachineCreator = await getCandyMachineCreator(candyMachinePk);
    log.info(candyMachineCreator[0].toBase58(), candyMachineCreator);
    const mintIds = await getAddressesByCreatorAddress(candyMachinePk, connection);
    log.info(`Found ${mintIds.length} mints`);
    return mintIds;
}

async function getProgramAccounts(
    connection: web3Js.Connection,
    programId: String,
    configOrCommitment?: any,
): Promise<Array<AccountAndPubkey>> {
    const extra: any = {};
    let commitment;
    //let encoding;

    if (configOrCommitment) {
        if (typeof configOrCommitment === 'string') {
            commitment = configOrCommitment;
        } else {
            commitment = configOrCommitment.commitment;
            //encoding = configOrCommitment.encoding;

            if (configOrCommitment.dataSlice) {
                extra.dataSlice = configOrCommitment.dataSlice;
            }

            if (configOrCommitment.filters) {
                extra.filters = configOrCommitment.filters;
            }
        }
    }

    const args = connection._buildArgs([programId], commitment, 'base64', extra);
    const unsafeRes = await (connection as any)._rpcRequest(
        'getProgramAccounts',
        args,
    );
    //console.log(unsafeRes)
    const data = (
        unsafeRes.result as Array<{
            account: web3Js.AccountInfo<[string, string]>;
            pubkey: string;
        }>
    ).map(item => {
        return {
            account: {
                // TODO: possible delay parsing could be added here
                data: Buffer.from(item.account.data[0], 'base64'),
                executable: item.account.executable,
                lamports: item.account.lamports,
                // TODO: maybe we can do it in lazy way? or just use string
                owner: item.account.owner,
            } as web3Js.AccountInfo<Buffer>,
            pubkey: item.pubkey,
        };
    });

    return data;
}


export async function getAccountsByCreatorAddress(creatorAddress: web3Js.PublicKey, connection: web3Js.Connection): Promise<(string | Metadata)[][]> {
    const metadataAccounts = await getProgramAccounts(
        connection,
        TOKEN_METADATA_PROGRAM.toBase58(),
        {
            filters: [
                {
                    memcmp: {
                        offset:
                            1 + // key
                            32 + // update auth
                            32 + // mint
                            4 + // name string length
                            MAX_NAME_LENGTH + // name
                            4 + // uri string length
                            MAX_URI_LENGTH + // uri*
                            4 + // symbol string length
                            MAX_SYMBOL_LENGTH + // symbol
                            2 + // seller fee basis points
                            1 + // whether or not there is a creators vec
                            4 + // creators vec length
                            0 * MAX_CREATOR_LEN,
                        bytes: creatorAddress,
                    },
                },
            ],
        },
    );
    const decodedAccounts = [];
    for (let i = 0; i < metadataAccounts.length; i++) {
        const e = metadataAccounts[i];
        const decoded = decodeMetadata(e.account.data);
        const accountPubkey = e.pubkey;
        const store = [decoded, accountPubkey];
        decodedAccounts.push(store);
    }
    return decodedAccounts;
}

export async function getAddressesByCreatorAddress(
    candyMachineAddr: web3Js.PublicKey,
    connection: web3Js.Connection,
): Promise<string[]> {
    try {
        const spinner = ora({ text: 'Calling rpc to get mints, please wait', spinner: cliSpinners.material });
        spinner.color = 'yellow';
        spinner.start();
        const accountsByCreatorAddress = await getAccountsByCreatorAddress(
            candyMachineAddr,
            connection,
        );
        const addresses = accountsByCreatorAddress.map(it => {
            return new web3Js.PublicKey((it[0] as Metadata).mint).toBase58();
        });
        spinner.succeed();
        return addresses;
    }
    catch (err: any) {
        log.error(err);
        throw err;
    }
}
