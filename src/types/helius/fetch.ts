import { HeliusDigitalAsset, HeliusDigitalAssetResult, HeliusDigitalAssetsResult, TransactionsArray } from "./types";
import { backOff } from 'exponential-backoff';

async function makePostRequest(url: string, body: any) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
}

async function makeGetRequestWithBackoff(url: string) {
    return backOff(async () => {
      const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    }, {
      numOfAttempts: 5, // Retry up to 5 times
      startingDelay: 500, // Start with a 500 ms delay
    });
  }
  

async function makePaginatedPostRequest(url: string, body: any, numOfAttempts: number = 5, startingDelay: number = 500) {
    return backOff(async () => {
      const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    }, {
      numOfAttempts: numOfAttempts,
      startingDelay: startingDelay,
    });
  }
  

  export async function searchAssetsOfOwnerByCollection(heliusUrl: string, collection: string, owner: string, id?: string) {
    try {
      const responseJson = await backOff(() => makePostRequest(heliusUrl, {
        jsonrpc: '2.0',
        id: id ? id : `search-assets-${owner}`,
        method: 'searchAssets',
        params: {
          ownerAddress: owner,
          grouping: ["collection", collection],
          page: 1,
          limit: 1000
        },
      }), {
        numOfAttempts: 5, // Retry up to 5 times
        startingDelay: 500, // Start with a 500 ms delay
      });
  
      const { result } = responseJson as HeliusDigitalAssetsResult;
      return result.items;
    }
    catch (e) {
      console.error('Error: searchAssets', e);
      return [];
    }
}

export const parseTransactionForAddressByType = async (tokenAddress: string, apiKey: string, type: string = "NFT_MINT", env: string = "devnet") => {
    const baseUrl = env === "devnet" ? "https://api-devnet.helius.xyz" : "https://api.helius.xyz";
    const url = `${baseUrl}/v0/addresses/${tokenAddress}/transactions?api-key=${apiKey}&type=${type}`;
    try {
        const data = await makeGetRequestWithBackoff(url);
        return data as TransactionsArray;
    } catch (e) {
        console.error('Error fetching transaction data:', e);
        throw e; // Rethrow the error to handle it in the calling code, if necessary
    }
}

export const getAsset = async (heliusUrl: string, assetId: string, id?: string) => {
    try {
        const responseJson = await makePostRequest(heliusUrl, {
            jsonrpc: "2.0",
            id: id ? id : `asset-id-${assetId}`,
            method: "getAsset",
            params: {
                id: assetId,
            },
        });

        const { result } = responseJson as HeliusDigitalAssetResult;
        return result;
    } catch (e) {
        console.error(`Error fetching asset ${assetId}:`, e);
        throw e; // Rethrow the error to handle it in the calling code, if necessary
    }
}

export const getAssetsByCollection = async (heliusUrl: string, collection: string, id?: string) => {
    console.time("getAssetsByGroup");
    let page = 1;
    let paginate = true;
    let assetList: HeliusDigitalAsset[] = [];

    while (paginate) {
        try {
            const responseJson = await makePaginatedPostRequest(heliusUrl, {
                jsonrpc: "2.0",
                id: id ? id : `collection-id-${page}`,
                method: "getAssetsByGroup",
                params: {
                    groupKey: "collection",
                    groupValue: collection,
                    page: page,
                    limit: 1000,
                },
            });

            const { result } = responseJson as HeliusDigitalAssetsResult;
            assetList.push(...result.items);

            if (result.total !== 1000) {
                paginate = false;
            } else {
                page++;
            }
        } catch (e) {
            console.error(`Error on page ${page}:`, e);
            break; // Break the loop in case of persistent error
        }
    }

    console.timeEnd("getAssetsByGroup");
    const resultData = {
        totalResults: assetList.length,
        results: assetList,
    };
    return resultData;
};

export const getAssetsByAuthority = async (heliusUrl: string, authority: string, id?: string) => {
    console.time("getAssetsByAuthority");
    let page = 1;
    let paginate = true;
    let assetList: HeliusDigitalAsset[] = [];

    while (paginate) {
        try {
            const responseJson = await makePaginatedPostRequest(heliusUrl, {
                jsonrpc: "2.0",
                id: id ? id : `authority-id-${page}`,
                method: "getAssetsByAuthority",
                params: {
                    authorityAddress: authority,
                    page: page,
                    limit: 1000,
                },
            });

            const { result } = responseJson as HeliusDigitalAssetsResult;
            assetList.push(...result.items);

            if (result.total !== 1000) {
                paginate = false;
            } else {
                page++;
            }
        } catch (e) {
            console.error(`Error on page ${page}:`, e);
            break; // Break the loop in case of persistent error
        }
    }

    console.timeEnd("getAssetsByAuthority");
    const resultData = {
        totalResults: assetList.length,
        results: assetList,
    };
    return resultData;
};

export const getAssetsByCreator = async (heliusUrl: string, creator: string, onlyVerified: boolean = true, id?: string) => {
    console.time("getAssetsByCreator");
    let page = 1;
    let paginate = true;
    let assetList: HeliusDigitalAsset[] = [];

    while (paginate) {
        try {
            const responseJson = await makePaginatedPostRequest(heliusUrl, {
                jsonrpc: "2.0",
                id: id ? id : `creator-id-${page}`,
                method: "getAssetsByCreator",
                params: {
                    creatorAddress: creator,
                    onlyVerified: onlyVerified,
                    page: page,
                    limit: 1000,
                },
            });

            const { result } = responseJson as HeliusDigitalAssetsResult;
            assetList.push(...result.items);

            if (result.total !== 1000) {
                paginate = false;
            } else {
                page++;
            }
        } catch (e) {
            console.error(`Error on page ${page}:`, e);
            break; // Break the loop in case of persistent error
        }
    }

    console.timeEnd("getAssetsByCreator");
    const resultData = {
        totalResults: assetList.length,
        results: assetList,
    };
    return resultData;
};