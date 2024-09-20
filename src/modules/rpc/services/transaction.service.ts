import { Injectable, Logger } from '@nestjs/common';
import { TypedTransaction } from '@ethereumjs/tx';
import { getAddress } from 'ethers';
import { tryParseSignedTx } from '../aa/utils';
import { random } from 'lodash';
import { LRUCache } from 'lru-cache';
import { TRANSACTION_STATUS, TransactionEntity } from '../entities/transaction.entity';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsSelect, FindOptionsSelectByString, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { USER_OPERATION_STATUS, UserOperationEntity } from '../entities/user-operation.entity';

@Injectable()
export class TransactionService {
    public readonly globalTransactionCache: LRUCache<number, TransactionEntity> = new LRUCache({
        max: 100000,
        ttl: 600000, // 10 mins
    });

    public constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(TransactionEntity) private readonly transactionRepository: Repository<TransactionEntity>,
    ) {}

    public async getTransactionsByStatus(
        chainIds: number[],
        status: TRANSACTION_STATUS,
        limit: number,
        select?: FindOptionsSelect<TransactionEntity>,
    ): Promise<TransactionEntity[]> {
        return await this.transactionRepository.find({
            where: { chainId: In(chainIds), status },
            order: { id: 'ASC' },
            take: limit,
            select: select,
        });
    }

    public async getRecentTransactionsByStatusSortConfirmations(
        chainIds: number[],
        status: TRANSACTION_STATUS,
        limit: number,
    ): Promise<TransactionEntity[]> {
        const recentData = new Date(Date.now() - 10000); // 10s ago

        // sort by confirmations
        if (random(0, 1) === 0) {
            return await this.transactionRepository.find({
                where: { chainId: In(chainIds), status, latestSentAt: MoreThanOrEqual(recentData) },
                order: { confirmations: 'ASC' },
                take: limit,
            });
        }

        // sort by id
        return await this.transactionRepository.find({
            where: { chainId: In(chainIds), status, latestSentAt: MoreThanOrEqual(recentData) },
            order: { id: 'ASC' },
            take: limit,
        });
    }

    public async getLongAgoTransactionsByStatusSortConfirmations(
        chainIds: number[],
        status: TRANSACTION_STATUS,
        limit: number,
    ): Promise<TransactionEntity[]> {
        const recentData = new Date(Date.now() - 10000); // 10s ago

        if (random(0, 1) === 0) {
            return await this.transactionRepository.find({
                where: { chainId: In(chainIds), status, latestSentAt: LessThan(recentData) },
                order: { confirmations: 'ASC' },
                take: limit,
            });
        }

        return await this.transactionRepository.find({
            where: { chainId: In(chainIds), status, latestSentAt: LessThan(recentData) },
            order: { id: 'ASC' },
            take: limit,
        });
    }

    public async getLatestTransaction(chainId: number, sender: string): Promise<TransactionEntity> {
        return await this.transactionRepository.findOne({
            where: { chainId, from: sender },
            order: { nonce: 'DESC' },
        });
    }

    public async getTransactionById(id: number): Promise<TransactionEntity> {
        let transactionEntity = this.getGlobalCacheTransaction(id);
        if (!!transactionEntity) {
            if (transactionEntity.status === TRANSACTION_STATUS.DONE) {
                this.delGlobalCacheTransaction(id);
            }

            return transactionEntity;
        }

        transactionEntity = await this.transactionRepository.findOneBy({ id });
        if (!!transactionEntity && transactionEntity.status !== TRANSACTION_STATUS.DONE) {
            this.setGlobalCacheTransaction(transactionEntity);
        }

        return transactionEntity;
    }

    public async getPendingTransactionCountBySigner(chainId: number, signerAddress: string): Promise<number> {
        return await this.transactionRepository.count({
            where: { chainId, status: In([TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.LOCAL]), from: signerAddress },
        });
    }

    public async getPendingTransactionsBySigner(chainId: number, signerAddress: string): Promise<TransactionEntity[]> {
        return await this.transactionRepository.find({
            where: { chainId, status: In([TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.LOCAL]), from: signerAddress },
        });
    }

    public async createTransaction(
        transactionId: number,
        chainId: number,
        signedTx: any,
        userOperationHashes: string[],
    ): Promise<TransactionEntity> {
        const tx: TypedTransaction = tryParseSignedTx(signedTx);
        const txHash = `0x${Buffer.from(tx.hash()).toString('hex')}`;

        const start = Date.now();

        const transactionEntity = new TransactionEntity({
            id: transactionId,
            chainId,
            userOperationHashes,
            from: getAddress(tx.getSenderAddress().toString()),
            to: getAddress(tx.to.toString()),
            nonce: Number(tx.nonce),
            inners: { [txHash]: tx.toJSON() },
            signedTxs: { [txHash]: signedTx },
            status: TRANSACTION_STATUS.LOCAL,
            txHashes: [txHash],
            confirmations: 0,
            incrRetry: 0,
            userOperationHashMapTxHash: {},
            receipts: {},
            latestSentAt: new Date(),
        });

        await this.transactionRepository.save(transactionEntity);

        Logger.debug(`[CreateTransaction] ${transactionId}, Cost ${Date.now() - start} ms`);

        this.setGlobalCacheTransaction(transactionEntity);

        return transactionEntity;
    }

    public async addTransactionsConfirmations(ids: number[]) {
        if (ids.length === 0) {
            return;
        }

        await this.dataSource.query(`UPDATE transactions SET confirmations = confirmations + 1 WHERE id IN (${ids.join(',')});`);
    }

    public async updateTransaction(transactionEntity: TransactionEntity, updates: any) {
        updates.updatedAt = new Date();
        Object.assign(transactionEntity, updates);

        await this.transactionRepository
            .createQueryBuilder()
            .update(TransactionEntity)
            .set(updates)
            .where('id = :id', {
                id: transactionEntity.id,
            })
            .execute();

        if (transactionEntity.status === TRANSACTION_STATUS.DONE) {
            this.delGlobalCacheTransaction(transactionEntity.id);
        }
    }

    public async deleteTransactionAndResetUserOperations(transactionId: number) {
        await this.transactionRepository.manager.transaction(async (entityManager) => {
            const lockedUserOperationEntities = await entityManager.find(UserOperationEntity, {
                where: { transactionId, status: USER_OPERATION_STATUS.PENDING },
                lock: { mode: 'pessimistic_write' },
            });

            await entityManager.delete(TransactionEntity, transactionId);

            for (const lockedUserOperationEntity of lockedUserOperationEntities) {
                lockedUserOperationEntity.status = USER_OPERATION_STATUS.LOCAL;
                lockedUserOperationEntity.transactionId = 0;
                await entityManager.save(lockedUserOperationEntity);
            }
        });

        this.delGlobalCacheTransaction(transactionId);
    }

    public async replaceTransactionTxHash(transactionEntity: TransactionEntity, newSignedTx: string, currentStatus: TRANSACTION_STATUS) {
        const tx: TypedTransaction = tryParseSignedTx(newSignedTx);
        const newTxHash = `0x${Buffer.from(tx.hash()).toString('hex')}`;
        const newTxData = tx.toJSON();

        const newSignedTxs = transactionEntity.signedTxs;
        newSignedTxs[newTxHash] = newSignedTx;
        const newInner = transactionEntity.inners;
        newInner[newTxHash] = newTxData;
        const newTxHashes = transactionEntity.txHashes.concat(newTxHash);

        const updates = {
            incrRetry: 0,
            txHashes: newTxHashes,
            signedTxs: newSignedTxs,
            inners: newInner,
            latestSentAt: new Date(),
            updatedAt: new Date(),
        };

        Object.assign(transactionEntity, updates);

        await this.transactionRepository
            .createQueryBuilder()
            .update(TransactionEntity)
            .set(updates)
            .where('id = :id AND status = :status', {
                id: transactionEntity.id,
                status: currentStatus,
            })
            .execute();
    }

    public setGlobalCacheTransaction(transactionEntity: TransactionEntity) {
        this.globalTransactionCache.set(transactionEntity.id, transactionEntity);
    }

    public getGlobalCacheTransaction(transactionId: number): TransactionEntity {
        return this.globalTransactionCache.get(transactionId);
    }

    public delGlobalCacheTransaction(transactionId: number) {
        this.globalTransactionCache.delete(transactionId);
    }
}
