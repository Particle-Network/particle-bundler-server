import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';

export async function bundler_clearState(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    await rpcService.aaService.userOperationService.deleteAllLocalUserOperations(chainId);

    return 'ok';
}
