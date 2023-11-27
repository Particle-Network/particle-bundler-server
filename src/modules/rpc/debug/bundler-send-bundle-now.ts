import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';

export async function bundler_sendBundleNow(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    return 'ok';
}
