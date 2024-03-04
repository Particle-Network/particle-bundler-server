import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { USER_OPERATION_STATUS, UserOperationDocument } from '../schemas/user-operation.schema';
import { Contract } from 'ethers';
import entryPointAbi from './abis/entry-point-abi';
import { TRANSACTION_STATUS } from '../schemas/transaction.schema';
import { BigNumber } from '../../../common/bignumber';
import { deepHexlify } from './utils';
import { Alert } from '../../../common/alert';

export async function getUserOperationReceipt(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 1, -32602);
    Helper.assertTrue(typeof body.params[0] === 'string', -32602);

    const userOperationService = rpcService.aaService.userOperationService;
    const transactionService = rpcService.aaService.transactionService;

    const userOperation = await userOperationService.getUserOperationByHash(chainId, body.params[0]);
    if (!userOperation || userOperation.status === USER_OPERATION_STATUS.LOCAL || userOperation.blockNumber <= 0) {
        return null;
    }

    const receipt = rpcService.aaService.getUserOpHashReceipts(chainId, body.params[0]);
    if (!!receipt && userOperation.status !== USER_OPERATION_STATUS.DONE) {
        return await manuallyGetUserOperationReceipt(chainId, rpcService, userOperation, receipt);
    }

    const [transaction, userOperationEvent] = await Promise.all([
        transactionService.getTransaction(chainId, userOperation.txHash),
        userOperationService.getUserOperationEvent(chainId, userOperation.userOpHash),
    ]);

    if (userOperation.status === USER_OPERATION_STATUS.PENDING && !!transaction && transaction.status === TRANSACTION_STATUS.PENDING) {
        if (Date.now() - transaction.latestSentAt.getTime() > 5000) {
            return await manuallyGetUserOperationReceipt(chainId, rpcService, userOperation);
        }
    }

    if (!transaction || ![TRANSACTION_STATUS.FAILED, TRANSACTION_STATUS.SUCCESS].includes(transaction.status)) {
        return null;
    }

    const logs = [];
    for (const logItem of transaction.receipt.logs ?? []) {
        if (logItem.topics.includes(userOperation.userOpHash)) {
            logs.push(logItem);
        }
    }

    return deepHexlify({
        userOpHash: userOperation.userOpHash,
        sender: userOperation.userOpSender,
        nonce: BigNumber.from(userOperation.origin?.nonce).toHexString(),
        actualGasCost: BigNumber.from(userOperationEvent?.args[5] ?? 0).toHexString(),
        actualGasUsed: BigNumber.from(userOperationEvent?.args[6] ?? 0).toHexString(),
        success: userOperationEvent?.args[4] ?? false,
        logs,
        receipt: transaction.receipt,
    });
}

export async function manuallyGetUserOperationReceipt(
    chainId: number,
    rpcService: RpcService,
    userOperation: UserOperationDocument,
    receipt?: any,
) {
    try {
        const provider = rpcService.getJsonRpcProvider(chainId);
        if (!receipt) {
            receipt = await rpcService.getTransactionReceipt(provider, userOperation.txHash);
        }

        // failed transaction use local database value
        if (!receipt || BigNumber.from(receipt.status).toNumber() === 0) {
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
        console.error(error);
        Alert.sendMessage(`Failed to get user operation receipt: ${Helper.converErrorToString(error)}`);

        return null;
    }
}
