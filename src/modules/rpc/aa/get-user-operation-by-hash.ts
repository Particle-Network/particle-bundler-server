import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { deepHexlify } from './utils';

export async function getUserOperationByHash(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 1, -32602);
    Helper.assertTrue(typeof body.params[0] === 'string', -32602);

    const userOperationEntity = await rpcService.userOperationService.getUserOperationByHash(body.params[0]);
    if (!userOperationEntity || !userOperationEntity.transactionId) {
        return null;
    }

    const transaction = await rpcService.transactionService.getTransactionById(userOperationEntity.transactionId);
    if (!transaction) {
        return null;
    }

    return deepHexlify({
        userOperation: userOperationEntity.origin,
        entryPoint: userOperationEntity.entryPoint,
        transactionHash: transaction.txHashes[transaction.txHashes.length - 1],
        blockHash: userOperationEntity.blockHash ?? null,
        blockNumber: userOperationEntity.blockNumber ?? null,
    });
}
