import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { deepHexlify, toBeHexTrimZero } from './utils';
import { IS_PRODUCTION } from '../../../common/common-types';
import { entryPointAbis } from './abis/entry-point-abis';
import { USER_OPERATION_STATUS, UserOperationEntity } from '../entities/user-operation.entity';
import { TRANSACTION_STATUS } from '../entities/transaction.entity';
import { EVM_CHAIN_ID } from '../../../common/chains';

export async function getUserOperationReceipt(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 1, -32602);
    Helper.assertTrue(typeof body.params[0] === 'string' && body.params[0].length === 66, -32602);

    const userOperationService = rpcService.userOperationService;
    const transactionService = rpcService.transactionService;

    const userOperationEntity = await userOperationService.getUserOperationByHash(body.params[0]);
    if (!userOperationEntity) {
        return null;
    }

    if (userOperationEntity.status !== USER_OPERATION_STATUS.DONE) {
        return null;
    }

    const transaction = await transactionService.getTransactionById(userOperationEntity.transactionId);
    if (
        !transaction ||
        transaction.status !== TRANSACTION_STATUS.DONE ||
        !transaction.userOperationHashMapTxHash[userOperationEntity.userOpHash]
    ) {
        return null;
    }

    let receipt = transaction.receipts[transaction.userOperationHashMapTxHash[userOperationEntity.userOpHash]];
    if (!receipt) {
        return null;
    }

    // these chains may reorg, so the receipt cache may not reflect the final version, so here re-request
    if ([EVM_CHAIN_ID.BERACHAIN_TESTNET_BARTIO].includes(transaction.chainId) && !!receipt?.transactionHash) {
        receipt = await rpcService.chainService.getTransactionReceipt(transaction.chainId, receipt.transactionHash);
        if (!receipt) {
            return null;
        }
    }

    return formatReceipt(rpcService, userOperationEntity, receipt);
}

export function formatReceipt(rpcService: RpcService, userOperation: UserOperationEntity, receipt: any) {
    try {
        // failed transaction use local database value
        // failed transaction has no logs
        if (BigInt(receipt.status) === 0n) {
            return {
                success: false,
                ...deepHexlify({
                    userOpHash: userOperation.userOpHash,
                    sender: userOperation.userOpSender,
                    nonce: toBeHexTrimZero(userOperation.origin?.nonce),
                    receipt,
                }),
            };
        }

        const entryPointVersion = rpcService.getVersionByEntryPoint(userOperation.entryPoint);
        const contract = rpcService.getSetCachedContract(userOperation.entryPoint, entryPointAbis[entryPointVersion]);
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

        return {
            success: userOperationEvent?.args[4] ?? false,
            ...deepHexlify({
                userOpHash: userOperation.userOpHash,
                sender: userOperation.userOpSender,
                nonce: toBeHexTrimZero(userOperation.origin?.nonce),
                actualGasCost: toBeHexTrimZero(userOperationEvent?.args[5] ?? 0),
                actualGasUsed: toBeHexTrimZero(userOperationEvent?.args[6] ?? 0),
                logs,
                receipt,
            }),
        };
    } catch (error) {
        if (!IS_PRODUCTION) {
            console.error('Failed to format receipt', error);
        }

        rpcService.larkService.sendMessage(`Failed to format receipt: ${Helper.converErrorToString(error)}`);
        return null;
    }
}
