import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { deepHexlify } from './utils';
import P2PCache from '../../../common/p2p-cache';
import { keyCacheChainUserOpHashTxHash } from '../../../common/common-types';

export async function getUserOperationByHash(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 1, -32602);
    Helper.assertTrue(typeof body.params[0] === 'string', -32602);

    const txHash = P2PCache.get(keyCacheChainUserOpHashTxHash(body.params[0]));
    if (!!txHash) {
        return deepHexlify({
            transactionHash: txHash,
        });
    }

    const userOperation = await rpcService.aaService.userOperationService.getUserOperationByHash(body.params[0]);
    if (!userOperation || !userOperation.transactionId) {
        return null;
    }

    const transaction = await rpcService.aaService.transactionService.getTransactionById(userOperation.transactionId);
    if (!transaction) {
        return null;
    }

    return deepHexlify({
        userOperation: userOperation.origin,
        entryPoint: userOperation.entryPoint,
        transactionHash: transaction.txHashes[transaction.txHashes.length - 1],
        blockHash: userOperation.blockHash ?? null,
        blockNumber: userOperation.blockNumber ?? null,
    });
}
