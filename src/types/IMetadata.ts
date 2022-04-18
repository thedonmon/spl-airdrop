export interface IMetadata {
    name: string;
    symbol: string;
    description: string;
    seller_fee_basis_points: number;
    image: string;
    external_url: string;
    attributes?: (AttributesEntity)[] | null;
    collection: Collection;
    properties: Properties;
  }
  export interface AttributesEntity {
    trait_type: string;
    value: string;
  }
  export interface Collection {
    name: string;
    family: string;
  }
  export interface Properties {
    files: (FilesEntity)[];
    category: string;
    creators?: (CreatorsEntity)[] | null;
  }
  export interface FilesEntity {
    uri: string;
    type: string;
  }
  export interface CreatorsEntity {
    address: string;
    share: number;
  }
  