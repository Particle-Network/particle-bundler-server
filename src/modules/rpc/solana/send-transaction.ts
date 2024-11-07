import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { VersionedTransaction } from '@solana/web3.js';
import { AppException } from '../../../common/app-exception';
import { Logger } from '@nestjs/common';
import { SolanaTransactionEntity } from '../entities/solana-transaction.entity';
import { ChainService } from '../services/chain.service';
import { SolanaTransactionService } from '../services/solana-transaction.service';
import { LarkService } from '../../common/services/lark.service';
import { UserOperationEventEntity } from '../entities/user-operation-event.entity';
import { onEmitUserOpEvent } from '../../../configs/bundler-common';
import { UserOperationService } from '../services/user-operation.service';

export async function sendTransaction(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.isAuth, -32613);

    Helper.assertTrue(body.params.length >= 1, -32602);
    Helper.assertTrue(typeof body.params[0] === 'object', -32602);

    const { userOpHash, serializedTransaction, expiredAt } = body.params[0];
    Helper.assertTrue(typeof userOpHash === 'string', -32602);
    Helper.assertTrue(typeof serializedTransaction === 'string', -32602);
    Helper.assertTrue(typeof expiredAt === 'number', -32602);

    const options = body.params[1] || { encoding: 'base64', preflightCommitment: 'confirmed' };
    Helper.assertTrue(typeof options === 'object', -32602);

    // force check
    options.skipPreflight = false;

    let transaction: VersionedTransaction;
    try {
        const buffer = Buffer.from(serializedTransaction, 'base64');
        transaction = VersionedTransaction.deserialize(buffer);
    } catch (error) {
        throw new AppException(-32612);
    }

    const transactionEntity = await rpcService.solanaTransactionService.createTransaction(chainId, userOpHash, transaction, expiredAt);

    Logger.debug(`[CreateSolanaTransaction] ${transactionEntity.chainId} | ${transactionEntity.id}`);

    return await sendTransactionAndUpdateStatus(
        rpcService.chainService,
        rpcService.solanaTransactionService,
        rpcService.larkService,
        rpcService.userOperationService,
        transactionEntity,
        options,
    );
}

export async function sendTransactionAndUpdateStatus(
    chainService: ChainService,
    solanaTransactionService: SolanaTransactionService,
    larkService: LarkService,
    userOperationService: UserOperationService,
    transactionEntity: SolanaTransactionEntity,
    options: any,
) {
    try {
        const res = await chainService.solanaSendTransaction(transactionEntity.chainId, transactionEntity.serializedTransaction, options);
        if (!!res?.result) {
            const txSignature = res.result;
            await solanaTransactionService.updateTransactionAsPending(transactionEntity, txSignature);
            return txSignature;
        }

        if (!res || !res.result) {
            const errorMessage = Helper.converErrorToString(res).toLowerCase();
            if (errorMessage.includes('timeout') || errorMessage.includes('429')) {
                return null;
            }

            if (errorMessage.includes('blockhash not found')) {
                await solanaTransactionService.updateTransactionAsSentFailed(transactionEntity);

                const userOperationEventEntity = new UserOperationEventEntity({
                    chainId: transactionEntity.chainId,
                    blockHash: '',
                    blockNumber: 0,
                    userOpHash: transactionEntity.userOpHash,
                    txHash: '',
                    entryPoint: '',
                    topic: '',
                    args: ['', '', '', '', false, '', ''],
                });

                userOperationService.createUserOperationEvents([userOperationEventEntity]);

                onEmitUserOpEvent(transactionEntity.userOpHash, userOperationEventEntity);
            }

            larkService.sendMessage(`[SendSolanaTransactionFailed] ${transactionEntity.id} | ${transactionEntity.chainId} | ${errorMessage}`);
        }

        return null;
    } catch (error) {
        // ignore timeout error
        console.error(error);

        throw new AppException(-32612, Helper.converErrorToString(error));
    }
}
