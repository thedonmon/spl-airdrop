export type MetadataModel = {
    name?: string;
    symbol?: string;
    description?: string;
    seller_fee_basis_points?: number;
    image?: string;
    external_url?: string;
    animation_url?: string;
    attributes?: (AttributesEntity)[] | null;
    collection?: Collection;
    properties?: Properties;
  }
  export type AttributesEntity = {
    trait_type?: string;
    value?: string;
  }
  export type Collection = {
    name?: string;
    family?: string;
  }
  export type Properties = {
    files?: (FilesEntity)[];
    category?: string;
    creators?: (CreatorsEntity)[] | null;
  }
  export type FilesEntity = {
    uri: string;
    type: string;
  }
  export type CreatorsEntity = {
    address?: string;
    share?: number;
  }
  