import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { USER_OPERATION_STATUS, UserOperationDocument } from '../schemas/user-operation.schema';
import { Contract } from 'ethers';
import entryPointAbi from './abis/entry-point-abi';
import { TRANSACTION_STATUS } from '../schemas/transaction.schema';
import { deepHexlify } from './utils';
import P2PCache from '../../../common/p2p-cache';
import { IS_PRODUCTION, keyCacheChainReceipt } from '../../../common/common-types';

export async function getUserOperationReceipt(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 1, -32602);
    Helper.assertTrue(typeof body.params[0] === 'string', -32602);

    const userOperationService = rpcService.aaService.userOperationService;
    const transactionService = rpcService.aaService.transactionService;

    const userOperation = await userOperationService.getUserOperationByHash(body.params[0]);
    if (!userOperation) {
        return null;
    }

    let receipt = P2PCache.get(keyCacheChainReceipt(userOperation.chainId, userOperation.transactionId));
    if (!!receipt) {
        return formatReceipt(rpcService, userOperation, receipt);
    }

    if (userOperation.status !== USER_OPERATION_STATUS.DONE) {
        return null;
    }

    const transaction = await transactionService.getTransactionById(userOperation.transactionId);
    if (!transaction || transaction.status !== TRANSACTION_STATUS.DONE || !transaction.userOperationHashMapTxHash[userOperation.userOpHash]) {
        return null;
    }

    receipt = transaction.receipts[transaction.userOperationHashMapTxHash[userOperation.userOpHash]];
    if (!receipt) {
        return null;
    }

    return formatReceipt(rpcService, userOperation, receipt);
}

export function formatReceipt(rpcService: RpcService, userOperation: UserOperationDocument, receipt: any) {
    try {
        // failed transaction use local database value
        if (BigInt(receipt.status) === 0n) {
            return null;
        }

        const contract = new Contract(userOperation.entryPoint, entryPointAbi);
        const logs = [];
        let userOperationEvent: any;
        for (const log of receipt?.logs ?? []) {
            try {
                const parsed = contract.interface.parseLog(log);
                if (parsed?.name !== 'UserOperationEvent') {
                    continue;
                }

                if (parsed?.args?.userOpHash !== userOperation.userOpHash) {
                    continue;
                }

                logs.push(log);
                userOperationEvent = parsed;

                break;
            } catch (error) {
                // May not be an EntryPoint event.
                continue;
            }
        }

        return deepHexlify({
            userOpHash: userOperation.userOpHash,
            sender: userOperation.userOpSender,
            nonce: userOperation.origin?.nonce,
            actualGasCost: userOperationEvent?.args[5] ?? 0,
            actualGasUsed: userOperationEvent?.args[6] ?? 0,
            success: userOperationEvent?.args[4] ?? false,
            logs,
            receipt,
        });
    } catch (error) {
        if (!IS_PRODUCTION) {
            console.error('Failed to format receipt', error);
        }

        rpcService.larkService.sendMessage(`Failed to format receipt: ${Helper.converErrorToString(error)}`);
        return null;
    }
}
