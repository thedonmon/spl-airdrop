import { HolderAccount } from './holderaccounts';
export type CollectionSearch = {
    address: string;
    type: CollectionAddressType;
    verified?: boolean;
    name?: string;
}

export type CollectionAddressType = "collection" | "authority" | "creator"

export type CollectionSearchResult = {
    address: string,
    collectionName?: string,
    verified?: boolean,
    type: CollectionAddressType,
    holders: number,
    frozen: number,
    delegated: number,
    holderMints: HolderAccount[],
}

export type CollectionSearchOverlapHolders = {

}