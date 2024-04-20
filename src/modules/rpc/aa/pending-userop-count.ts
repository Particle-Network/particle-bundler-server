import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';

export async function pendingUserOpCount(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    return await rpcService.aaService.userOperationService.getPendingUserOperationCount(chainId);
}
