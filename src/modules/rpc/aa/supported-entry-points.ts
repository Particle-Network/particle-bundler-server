import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';

export async function supportedEntryPoints(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    return ['0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'];
}
