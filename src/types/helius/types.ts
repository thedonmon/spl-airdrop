export type NFTEvent = {
    description: string;
    type: string;
    source: string;
    amount: number;
    fee: number;
    feePayer: string;
    signature: string;
    slot: number;
    timestamp: number;
    saleType: string;
    buyer: string;
    seller: string;
    staker: string;
    nfts: NFTDetail[];
  };
  
export type NFTDetail = {
    mint: string;
    tokenStandard: string;
  };
  
  export type SetAuthorityEvent = {
    account: string;
    from: string;
    to: string;
    instructionIndex: number;
    innerInstructionIndex: number;
  };
  
  export type TokenTransfer = {
    fromTokenAccount: string;
    toTokenAccount: string;
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
    tokenStandard: string;
  };
  
  export type NativeTransfer = {
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  };
  
  export type AccountData = {
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: TokenBalanceChange[];
  };
  
  export type TokenBalanceChange = {
    userAccount: string;
    tokenAccount: string;
    rawTokenAmount: RawTokenAmount;
    mint: string;
  };
  
  export type RawTokenAmount = {
    tokenAmount: string;
    decimals: number;
  };
  
  export type Instruction = {
    accounts: string[];
    data: string;
    programId: string;
    innerInstructions: InnerInstruction[];
  };
  
  export type InnerInstruction = {
    accounts: string[];
    data: string;
    programId: string;
  };
  
  export type Transaction = {
    description: string;
    type: string;
    source: string;
    fee: number;
    feePayer: string;
    signature: string;
    slot: number;
    timestamp: number;
    tokenTransfers: TokenTransfer[];
    nativeTransfers: NativeTransfer[];
    accountData: AccountData[];
    transactionError: null | string;
    instructions: Instruction[];
    events: {
      nft: NFTEvent;
      setAuthority: SetAuthorityEvent[];
    };
  };
  
  export type TransactionsArray = Transaction[];


  export type HeliusDigitalAssetResult = {
	jsonrpc: string;
	result: HeliusDigitalAsset;
};

export type HeliusDigitalAssetsResult = {
	jsonrpc: string;
	result: DigitalAssetsResults;
};

export type DigitalAssetsResults = {
	total: number;
	limit: number;
	page: number;
	items: HeliusDigitalAsset[];
};

export type HeliusDigitalAsset = {
	interface: string;
	id: string;
	content: Content;
	authorities: Authority[];
	compression: Compression;
	grouping: Grouping[];
	royalty: Royalty;
	creators: Creator[];
	ownership: Ownership;
	supply: number | null;
	mutable: boolean;
	burnt: boolean;
};

export type Authority = {
	address: string;
	scopes: string[];
};

export type Compression = {
	eligible: boolean;
	compressed: boolean;
	data_hash: string;
	creator_hash: string;
	asset_hash: string;
	tree: string;
	seq: number;
	leaf_id: number;
};

export type Content = {
	$schema: string;
	json_uri: string;
	files: File[];
	metadata: Metadata;
	links: Links;
};

export type File = {
	uri: string;
	cdn_uri: string;
	mime: string;
};

export type Links = {
	external_url: string;
};

export type Metadata = {
	attributes: Attribute[];
	description: string;
	name: string;
	symbol: string;
};

export type Attribute = {
	value: number | string;
	trait_type: string;
};

export type Creator = {
	address: string;
	share: number;
	verified: boolean;
};

export type Grouping = {
	group_key: string;
	group_value: string;
};

export type Ownership = {
	frozen: boolean;
	delegated: boolean;
	delegate: string | null;
	ownership_model: string;
	owner: string;
};

export type Royalty = {
	royalty_model: string;
	target: string | null;
	percent: number;
	basis_points: number;
	primary_sale_happened: boolean;
	locked: boolean;
};

export type DelegateAccountType = {
	address: string;
	owner: string;
	addresses: DelegateAddressType[]
}

export type DelegateAddressType = {
	address: string;
	signed: boolean;
}

export type FetchAssetsFunction = (url: string, address: string) => Promise<{ totalResults: number; results: HeliusDigitalAsset[]; }>;