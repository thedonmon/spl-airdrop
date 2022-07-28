export interface RpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: any;
}
