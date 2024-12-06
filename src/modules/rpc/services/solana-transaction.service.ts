import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { SOLANA_TRANSACTION_STATUS, SolanaTransactionEntity } from '../entities/solana-transaction.entity';
import { VersionedTransaction } from '@solana/web3.js';
import * as bs58 from 'bs58';

@Injectable()
export class SolanaTransactionService {
    public constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(SolanaTransactionEntity) private readonly solanaTransactionRepository: Repository<SolanaTransactionEntity>,
    ) {}

    public async createTransaction(
        chainId: number,
        userOpHash: string,
        transaction: VersionedTransaction,
        expiredAt: number,
    ): Promise<SolanaTransactionEntity> {
        const txSignature = bs58.encode(transaction.signatures[0]);
        const serializedTransaction = Buffer.from(transaction.serialize()).toString('base64');

        const transactionEntity = new SolanaTransactionEntity({
            chainId,
            userOpHash,
            blockHash: transaction.message.recentBlockhash,
            serializedTransaction,
            status: SOLANA_TRANSACTION_STATUS.LOCAL,
            txSignature,
            confirmations: 0,
            failedReason: '',
            latestSentAt: new Date(),
            expiredAt,
        });

        return await this.solanaTransactionRepository.save(transactionEntity);
    }

    public async updateTransactionAsPending(transactionEntity: SolanaTransactionEntity) {
        const updated = {
            status: SOLANA_TRANSACTION_STATUS.PENDING,
            latestSentAt: new Date(),
            updatedAt: new Date(),
        };

        Object.assign(transactionEntity, updated);

        await this.solanaTransactionRepository.update({ id: transactionEntity.id, status: SOLANA_TRANSACTION_STATUS.LOCAL }, updated);
    }

    public async updateTransactionAsSentFailed(transactionEntity: SolanaTransactionEntity) {
        const updated = {
            status: SOLANA_TRANSACTION_STATUS.FAILED,
            updatedAt: new Date(),
        };

        Object.assign(transactionEntity, updated);

        await this.solanaTransactionRepository.update({ id: transactionEntity.id, status: SOLANA_TRANSACTION_STATUS.LOCAL }, updated);
    }

    public async updateTransactionAsDone(
        transactionEntity: SolanaTransactionEntity,
        receipt: any,
        status: SOLANA_TRANSACTION_STATUS,
        failedReason: string,
    ) {
        const updated = {
            status,
            receipt,
            failedReason,
            updatedAt: new Date(),
        };

        Object.assign(transactionEntity, updated);

        await this.solanaTransactionRepository.update({ id: transactionEntity.id }, updated);
    }

    public async getTransactionsByStatus(
        chainIds: number[],
        status: SOLANA_TRANSACTION_STATUS,
        limit: number,
        select?: any,
    ): Promise<SolanaTransactionEntity[]> {
        if (chainIds.length === 0) {
            return [];
        }

        return await this.solanaTransactionRepository.find({
            where: { chainId: In(chainIds), status },
            order: { id: 'ASC' },
            take: limit,
            select,
        });
    }

    public async addTransactionsConfirmations(ids: number[]) {
        if (ids.length === 0) {
            return;
        }

        await this.dataSource.query(
            `UPDATE ${this.solanaTransactionRepository.metadata.tableName} SET confirmations = confirmations + 1 WHERE id IN (${ids.join(
                ',',
            )});`,
        );
    }
}
