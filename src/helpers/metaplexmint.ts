import { Connection, clusterApiUrl, PublicKey, Cluster, AccountInfo } from '@solana/web3.js';
import log from 'loglevel';
import bs58 from 'bs58';
import cliSpinners from 'cli-spinners';
import ora from 'ora';
import { decodeMetadata, Metadata } from './metaplexschema';

export type AccountAndPubkey = {
    pubkey: string;
    account: AccountInfo<Buffer>;
};

const MAX_NAME_LENGTH = 32;
const MAX_URI_LENGTH = 200;
const MAX_SYMBOL_LENGTH = 10;
const MAX_CREATOR_LEN = 32 + 1 + 1;
const MAX_CREATOR_LIMIT = 5;
const MAX_DATA_SIZE = 4 + MAX_NAME_LENGTH + 4 + MAX_SYMBOL_LENGTH + 4 + MAX_URI_LENGTH + 2 + 1 + 4 + MAX_CREATOR_LIMIT * MAX_CREATOR_LEN;
const MAX_METADATA_LEN = 1 + 32 + 32 + MAX_DATA_SIZE + 1 + 1 + 9 + 172;
const CREATOR_ARRAY_START = 1 + 32 + 32 + 4 + MAX_NAME_LENGTH + 4 + MAX_URI_LENGTH + 4 + MAX_SYMBOL_LENGTH + 2 + 1 + 4;

const TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const CANDY_MACHINE_V2_PROGRAM = new PublicKey('cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ');

async function getMintAddresses(firstCreatorAddress: PublicKey, connection: Connection): Promise<string[]> {
    try {
        const spinner = ora({ text: 'Calling rpc to get mints, please wait', spinner: cliSpinners.material });
        spinner.color = 'yellow';
        spinner.start();
        const metadataAccounts = await connection.getProgramAccounts(
            TOKEN_METADATA_PROGRAM,
            {
                // The mint address is located at byte 33 and lasts for 32 bytes.
                dataSlice: { offset: 33, length: 32 },

                filters: [
                    // Only get Metadata accounts.
                    { dataSize: MAX_METADATA_LEN },

                    // Filter using the first creator.
                    {
                        memcmp: {
                            offset: CREATOR_ARRAY_START,
                            bytes: firstCreatorAddress.toBase58(),
                        },
                    },
                ],
            },
        );
        spinner.succeed();
        return metadataAccounts.map((metadataAccountInfo) => (
            bs58.encode(metadataAccountInfo.account.data)
        ));
    }
    catch (err: any) {
        log.error(err);
        throw err;
    }
};

async function getCandyMachineCreator(candyMachine: PublicKey): Promise<[PublicKey, number]> {
    const creatorTuple = PublicKey.findProgramAddress(
        [Buffer.from('candy_machine'), candyMachine.toBuffer()],
        CANDY_MACHINE_V2_PROGRAM,
    )
    return creatorTuple;
}

export async function getCandyMachineMints(candyMachineId: string, env: string = 'mainnet-beta', rpcUrl: string | null = null): Promise<string[]> {
    const connection = rpcUrl != null ? new Connection(rpcUrl) : new Connection('https://ssc-dao.genesysgo.net');
    const candyMachinePk = new PublicKey(candyMachineId);
    log.info(`Getting mints for candy machine ${candyMachineId}`);
    const candyMachineCreator = await getCandyMachineCreator(candyMachinePk);
    log.info(candyMachineCreator[0].toBase58(), candyMachineCreator);
    const mintIds = await getAddressesByCreatorAddress(candyMachinePk, connection);
    log.info(`Found ${mintIds.length} mints`);
    return mintIds;
}

async function getProgramAccounts(
    connection: Connection,
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
            account: AccountInfo<[string, string]>;
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
            } as AccountInfo<Buffer>,
            pubkey: item.pubkey,
        };
    });

    return data;
}


export async function getAccountsByCreatorAddress(creatorAddress: PublicKey, connection: Connection): Promise<(string | Metadata)[][]> {
    const metadataAccounts = await getProgramAccounts(
        connection,
        'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
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
    candyMachineAddr: PublicKey,
    connection: Connection,
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
            return new PublicKey((it[0] as Metadata).mint).toBase58();
        });
        spinner.succeed();
        return addresses;
    }
    catch (err: any) {
        log.error(err);
        throw err;
    }
}
