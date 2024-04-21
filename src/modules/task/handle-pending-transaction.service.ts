import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { RpcService } from '../rpc/services/rpc.service';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { BLOCK_SIGNER_REASON, IS_PRODUCTION, keyLockSendingTransaction } from '../../common/common-types';
import { TRANSACTION_STATUS, TransactionDocument } from '../rpc/schemas/transaction.schema';
import { TransactionService } from '../rpc/services/transaction.service';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { AAService } from '../rpc/services/aa.service';
import { getBundlerChainConfig } from '../../configs/bundler-common';

@Injectable()
export class HandlePendingTransactionService {
    // should be timestamp not boolean, can set a timeout
    private readonly lockSendingTransaction: Map<string, boolean> = new Map();

    public constructor(
        @InjectConnection() private readonly connection: Connection,
        private readonly rpcService: RpcService,
        private readonly larkService: LarkService,
        private readonly transactionService: TransactionService,
        private readonly userOperationService: UserOperationService,
        private readonly aaService: AAService,
    ) {}

    public async trySendAndUpdateTransactionStatus(transaction: TransactionDocument) {
        const keyLock = keyLockSendingTransaction(transaction.chainId, transaction.txHash);
        if (this.lockSendingTransaction.get(keyLock)) {
            console.log(`trySendAndUpdateTransactionStatus already acquired; Hash: ${transaction.txHash} On Chain ${transaction.chainId}`);
            return;
        }

        this.lockSendingTransaction.set(keyLock, true);
        console.log(`trySendAndUpdateTransactionStatus acquire; Hash: ${transaction.txHash} On Chain ${transaction.chainId}`);

        if (this.aaService.isBlockedSigner(transaction.chainId, transaction.from)) {
            console.log(
                `trySendAndUpdateTransactionStatus release isBlockedSigner ${transaction.from} On ${transaction.chainId}; Hash: ${transaction.txHash}, TransactionId: ${transaction.id}`,
            );
            this.lockSendingTransaction.delete(keyLock);
            return;
        }

        transaction = await this.transactionService.getTransactionById(transaction.id);
        if (!transaction || !transaction.isLocal()) {
            console.log(
                `trySendAndUpdateTransactionStatus release !transaction.isLocal(); Hash: ${transaction.txHash} On Chain ${transaction.chainId}`,
            );
            this.lockSendingTransaction.delete(keyLock);
            return;
        }

        try {
            const provider = this.rpcService.getJsonRpcProvider(transaction.chainId);
            const bundlerConfig = getBundlerChainConfig(transaction.chainId);
            const r = await provider.send(bundlerConfig.methodSendRawTransaction, [transaction.signedTx]);
            if (!!r?.error) {
                throw r.error;
            }
        } catch (error) {
            // insufficient funds for intrinsic transaction cost
            if (error?.message?.toLowerCase()?.includes('insufficient funds')) {
                this.aaService.setBlockedSigner(transaction.chainId, transaction.from, BLOCK_SIGNER_REASON.INSUFFICIENT_BALANCE, {
                    transactionId: transaction.id,
                });
            }

            if (error?.message?.toLowerCase()?.includes('nonce too low')) {
                // delete transaction and recover user op
                // nothing to do
                this.aaService.trySetTransactionCountLocalCache(transaction.chainId, transaction.from, transaction.nonce + 1);
                await Helper.startMongoTransaction(this.connection, async (session: any) => {
                    await Promise.all([
                        transaction.delete({ session }),
                        this.userOperationService.setPendingUserOperationsToLocalByCombinationHash(transaction.combinationHash, session),  
                    ]);
                });
            }

            if (!IS_PRODUCTION) {
                console.error(`SendTransaction error: ${transaction.id}`, error);
            }

            this.larkService.sendMessage(
                `Send Transaction Error On Chain ${transaction.chainId} And Transaction ${transaction.id}: ${Helper.converErrorToString(error)}`,
            );

            this.lockSendingTransaction.delete(keyLock);
            return;
        }

        await this.transactionService.updateTransactionStatus(transaction, TRANSACTION_STATUS.PENDING);

        console.log(`trySendAndUpdateTransactionStatus release hash: ${transaction.txHash} On Chain ${transaction.chainId}`);
        this.lockSendingTransaction.delete(keyLock);
    }
}
