import { Injectable, Logger } from '@nestjs/common';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { onEmitUserOpEvent } from '../../configs/bundler-common';
import { canRunCron, getSupportSolanaChainIdCurrentProcess } from '../rpc/aa/utils';
import { Cron } from '@nestjs/schedule';
import { ChainService } from '../rpc/services/chain.service';
import { UserOperationEventEntity } from '../rpc/entities/user-operation-event.entity';
import { SolanaTransactionService } from '../rpc/services/solana-transaction.service';
import { SOLANA_TRANSACTION_STATUS, SolanaTransactionEntity } from '../rpc/entities/solana-transaction.entity';
import { sendTransactionAndUpdateStatus } from '../rpc/solana';
import * as bs58 from 'bs58';

@Injectable()
export class HandlePendingSolanaTransactionService {
    private readonly lockedLocalTransactions: Set<number> = new Set();

    public constructor(
        private readonly larkService: LarkService,
        private readonly chainService: ChainService,
        private readonly userOperationService: UserOperationService,
        private readonly solanaTransactionService: SolanaTransactionService,
    ) {}

    @Cron('* * * * * *')
    public async handleRecentLocalTransactions() {
        if (!canRunCron()) {
            return;
        }

        const localTransactionEntities = await this.solanaTransactionService.getTransactionsByStatus(
            getSupportSolanaChainIdCurrentProcess(),
            SOLANA_TRANSACTION_STATUS.LOCAL,
            500,
            ['id', 'chainId', 'serializedTransaction', 'txSignature', 'userOpHash', 'createdAt', 'isMevProtected'],
        );

        for (const localTransactionEntity of localTransactionEntities) {
            // manual delay to avoid concurrent update
            if (Date.now() - 1000 > localTransactionEntity.createdAt.getTime()) {
                this.handleLocalTransactionsAction(localTransactionEntity);
            }
        }
    }

    private async handleLocalTransactionsAction(localTransactionEntity: SolanaTransactionEntity) {
        if (this.lockedLocalTransactions.has(localTransactionEntity.id)) {
            return;
        }

        this.lockedLocalTransactions.add(localTransactionEntity.id);

        try {
            const receipt = await this.chainService.solanaGetTransaction(localTransactionEntity.chainId, localTransactionEntity.txSignature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });

            if (!!receipt) {
                await this.handleSolanaReceipt(receipt, localTransactionEntity);
                return;
            }

            await sendTransactionAndUpdateStatus(
                this.chainService,
                this.solanaTransactionService,
                this.larkService,
                this.userOperationService,
                localTransactionEntity,
                { encoding: 'base64', preflightCommitment: 'confirmed' },
            );
        } catch (error) {
            Logger.error(`Failed to handle local solana transaction: ${localTransactionEntity.id}`, error);
            this.larkService.sendMessage(
                `Failed to handle local solana transaction: ${localTransactionEntity.id}: ${Helper.converErrorToString(error)}`,
            );
        }

        this.lockedLocalTransactions.delete(localTransactionEntity.id);
    }

    @Cron('* * * * * *')
    public async handleRecentPendingTransactions() {
        if (!canRunCron()) {
            return;
        }

        let pendingTransactions = await this.solanaTransactionService.getTransactionsByStatus(
            getSupportSolanaChainIdCurrentProcess(),
            SOLANA_TRANSACTION_STATUS.PENDING,
            500,
            ['id', 'chainId', 'serializedTransaction', 'txSignature', 'userOpHash', 'createdAt', 'expiredAt', 'isMevProtected'],
        );

        // async execute, no need to wait
        this.handlePendingTransactionsAction(pendingTransactions);
    }

    private async handlePendingTransactionsAction(pendingTransactions: SolanaTransactionEntity[]) {
        const promises = [];
        for (const pendingTransaction of pendingTransactions) {
            promises.push(this.getReceiptAndHandlePendingTransactions(pendingTransaction));
        }

        const transactionEntitiesAddConfirmations: SolanaTransactionEntity[] = (await Promise.all(promises)).filter((t) => !!t);
        this.solanaTransactionService.addTransactionsConfirmations(transactionEntitiesAddConfirmations.map((t) => t.id));
    }

    private async getReceiptAndHandlePendingTransactions(pendingTransactionEntity: SolanaTransactionEntity) {
        try {
            const receipt = await this.chainService.solanaGetTransaction(
                pendingTransactionEntity.chainId,
                pendingTransactionEntity.txSignature,
                {
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0,
                },
            );

            if (!receipt) {
                if (pendingTransactionEntity.expiredAt < Math.floor(Date.now() / 1000)) {
                    await this.handleSolanaReceipt({ meta: { err: 'User op expired' } }, pendingTransactionEntity);
                } else if (pendingTransactionEntity.createdAt.getTime() > Date.now() - 10000) {
                    // 重发, 避免节点在初次发送的时候 堵塞而丢弃交易
                    if (pendingTransactionEntity.isMevProtected) {
                        const base58EncodedTransaction = bs58.encode(Buffer.from(pendingTransactionEntity.serializedTransaction, 'base64'));
                        await this.chainService.solanaSendBundler(pendingTransactionEntity.chainId, [base58EncodedTransaction]);
                    } else {
                        await this.chainService.solanaSendTransaction(
                            pendingTransactionEntity.chainId,
                            pendingTransactionEntity.serializedTransaction,
                            { encoding: 'base64', preflightCommitment: 'confirmed', skipPreflight: false },
                        );
                    }
                }

                return null;
            }

            await this.handleSolanaReceipt(receipt, pendingTransactionEntity);

            return null;
        } catch (error) {
            Logger.error('getSolanaReceiptAndHandlePendingTransactions error', error);

            const errorMessage = Helper.converErrorToString(error);
            this.larkService.sendMessage(
                `getSolanaReceiptAndHandlePendingTransactions Error On Chain ${pendingTransactionEntity.chainId} For ${pendingTransactionEntity.id}: ${errorMessage}`,
            );
        }
    }

    private async handleSolanaReceipt(receipt: any, transactionEntity: SolanaTransactionEntity) {
        const isFailed = !!receipt.meta.err;

        const status = isFailed ? SOLANA_TRANSACTION_STATUS.FAILED : SOLANA_TRANSACTION_STATUS.SUCCESS;
        await this.solanaTransactionService.updateTransactionAsDone(
            transactionEntity,
            receipt,
            status,
            Helper.converErrorToString(receipt.meta.err),
        );

        Logger.debug(
            `[UpdateSolanaTransaction] ${transactionEntity.chainId} | ${transactionEntity.id} | ${transactionEntity.txSignature} | ${status}`,
        );

        const userOperationEventEntity = new UserOperationEventEntity({
            chainId: transactionEntity.chainId,
            blockHash: '',
            blockNumber: Number(receipt?.slot ?? 0),
            userOpHash: transactionEntity.userOpHash,
            txHash: transactionEntity.txSignature,
            entryPoint: '',
            topic: '',
            args: ['', '', '', '', !isFailed, '', ''],
        });

        await this.userOperationService.createUserOperationEvents([userOperationEventEntity]);

        onEmitUserOpEvent(transactionEntity.userOpHash, userOperationEventEntity);
    }
}
