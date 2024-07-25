import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId, Types } from 'mongoose';
import { TRANSACTION_STATUS, Transaction, TransactionDocument } from '../schemas/transaction.schema';
import { TypedTransaction } from '@ethereumjs/tx';
import { getAddress } from 'ethers';
import { getDocumentId, tryParseSignedTx } from '../aa/utils';
import { random } from 'lodash';

@Injectable()
export class TransactionService {
    public readonly globalTransactionCache: Map<string, Transaction> = new Map();

    public constructor(@InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>) {}

    public async getTransactionsByStatus(status: TRANSACTION_STATUS, limit: number): Promise<Transaction[]> {
        return await this.transactionModel.find({ status }).sort({ _id: 1 }).limit(limit).lean();
    }

    public async getRecentTransactionsByStatusSortConfirmations(status: TRANSACTION_STATUS, limit: number): Promise<Transaction[]> {
        const recentData = new Date(Date.now() - 10000); // 10s ago

        if (random(0, 1) === 0) {
            return await this.transactionModel
                .find({ status, latestSentAt: { $gte: recentData } })
                .sort({ confirmations: 1 })
                .limit(limit)
                .lean();
        }

        return await this.transactionModel
            .find({ status, latestSentAt: { $gte: recentData } })
            .sort({ _id: 1 })
            .limit(limit)
            .lean();
    }

    public async getLongAgoTransactionsByStatusSortConfirmations(status: TRANSACTION_STATUS, limit: number): Promise<TransactionDocument[]> {
        const recentData = new Date(Date.now() - 10000); // 10s ago

        if (random(0, 1) === 0) {
            return await this.transactionModel
                .find({ status, latestSentAt: { $lt: recentData } })
                .sort({ confirmations: 1 })
                .limit(limit)
                .lean();
        }

        return await this.transactionModel
            .find({ status, latestSentAt: { $lt: recentData } })
            .sort({ _id: 1 })
            .limit(limit)
            .lean();
    }

    public async getLatestTransaction(chainId: number, sender: string): Promise<Transaction> {
        return await this.transactionModel.findOne({ chainId, from: sender }).sort({ nonce: -1 }).lean();
    }

    public async getTransactionById(id: string): Promise<Transaction> {
        let transaction = this.getGlobalCacheTransaction(id);
        if (!!transaction) {
            if (transaction.status === TRANSACTION_STATUS.DONE) {
                this.delGlobalCacheTransaction(getDocumentId(transaction));
            }

            return transaction;
        }

        transaction = await this.transactionModel.findById(id).lean();
        if (!!transaction && transaction.status !== TRANSACTION_STATUS.DONE) {
            this.setGlobalCacheTransaction(transaction);
        }

        return transaction;
    }

    public async getPendingTransactionCountBySigner(chainId: number, signerAddress: string): Promise<number> {
        return await this.transactionModel.countDocuments({
            chainId,
            status: { $in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.LOCAL] },
            from: signerAddress,
        });
    }

    public async getPendingTransactionsBySigner(chainId: number, signerAddress: string): Promise<Transaction[]> {
        return await this.transactionModel.find({
            chainId,
            status: { $in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.LOCAL] },
            from: signerAddress,
        });
    }

    public async createTransaction(
        transactionObjectId: Types.ObjectId,
        chainId: number,
        signedTx: any,
        userOperationHashes: string[],
    ): Promise<TransactionDocument> {
        const tx: TypedTransaction = tryParseSignedTx(signedTx);
        const txHash = `0x${Buffer.from(tx.hash()).toString('hex')}`;

        const start = Date.now();

        const transaction = new this.transactionModel({
            _id: transactionObjectId,
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
            incrRetry: false,
            latestSentAt: new Date(),
        });

        Logger.debug(`[CreateTransaction] ${transaction.id}, Cost ${Date.now() - start} ms`);

        const transactionDoc = await transaction.save();
        this.setGlobalCacheTransaction(transactionDoc);

        return transactionDoc;
    }

    public async addTransactionsConfirmations(ids: string[]) {
        if (ids.length === 0) {
            return;
        }

        return await this.transactionModel.updateMany(
            { _id: { $in: ids } },
            {
                $inc: { confirmations: 1 },
            },
        );
    }

    public async updateTransaction(transaction: Transaction, updates: any) {
        Object.assign(transaction, updates);

        await this.transactionModel.updateOne({ _id: transaction._id }, updates);

        if (transaction.status === TRANSACTION_STATUS.DONE) {
            this.delGlobalCacheTransaction(getDocumentId(transaction));
        }
    }

    public async deleteTransaction(_id: ObjectId, session?: any) {
        await this.transactionModel.deleteOne({ _id }, { session });

        this.delGlobalCacheTransaction(_id.toString());
    }

    public async replaceTransactionTxHash(transaction: Transaction, newSignedTx: string, currentStatus: TRANSACTION_STATUS) {
        const tx: TypedTransaction = tryParseSignedTx(newSignedTx);
        const newTxHash = `0x${Buffer.from(tx.hash()).toString('hex')}`;
        const newTxData = tx.toJSON();

        const newSignedTxs = transaction.signedTxs;
        newSignedTxs[newTxHash] = newSignedTx;
        const newInner = transaction.inners;
        newInner[newTxHash] = newTxData;
        const newTxHashes = transaction.txHashes.concat(newTxHash);

        const updates = {
            incrRetry: false,
            txHashes: newTxHashes,
            signedTxs: newSignedTxs,
            inners: newInner,
            latestSentAt: new Date(),
        };

        Object.assign(transaction, updates);

        return await this.transactionModel.updateOne(
            { _id: transaction._id, status: currentStatus },
            {
                $set: updates,
            },
        );
    }

    public setGlobalCacheTransaction(transaction: Transaction) {
        this.globalTransactionCache.set(getDocumentId(transaction), transaction);
    }

    public getGlobalCacheTransaction(transactionId: string): Transaction {
        return this.globalTransactionCache.get(transactionId);
    }

    public delGlobalCacheTransaction(transactionId: string) {
        this.globalTransactionCache.delete(transactionId);
    }
}
