import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { USER_OPERATION_STATUS } from '../schemas/user-operation.schema';
import { deepHexlify } from './utils';

export async function getUserOperationByHash(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 1, -32602);
    Helper.assertTrue(typeof body.params[0] === 'string', -32602);

    const userOperation = await rpcService.aaService.userOperationService.getUserOperationByHash(chainId, body.params[0]);
    if (!userOperation || userOperation.status !== USER_OPERATION_STATUS.DONE) {
        return null;
    }

    return deepHexlify({
        userOperation: userOperation.origin,
        entryPoint: userOperation.entryPoint,
        transactionHash: userOperation.txHash,
        blockHash: userOperation.blockHash,
        blockNumber: userOperation.blockNumber,
    });
}
