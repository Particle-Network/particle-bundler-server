import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TRANSACTION_STATUS, Transaction, TransactionDocument } from '../schemas/transaction.schema';
import { TypedTransaction } from '@ethereumjs/tx';
import { getAddress } from 'ethers';
import { tryParseSignedTx } from '../aa/utils';
import { random } from 'lodash';

@Injectable()
export class TransactionService {
    public constructor(@InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>) {}

    public async getTransactionsByStatus(status: TRANSACTION_STATUS, limit: number): Promise<TransactionDocument[]> {
        return await this.transactionModel.find({ status }).sort({ _id: 1 }).limit(limit);
    }

    public async getRecentTransactionsByStatusSortConfirmations(status: TRANSACTION_STATUS, limit: number): Promise<TransactionDocument[]> {
        const recentData = new Date(Date.now() - 10000); // 10s ago

        if (random(0, 1) === 0) {
            return await this.transactionModel
                .find({ status, latestSentAt: { $gte: recentData } })
                .sort({ confirmations: 1 })
                .limit(limit);
        }

        return await this.transactionModel
            .find({ status, latestSentAt: { $gte: recentData } })
            .sort({ _id: 1 })
            .limit(limit);
    }

    public async getLongAgoTransactionsByStatusSortConfirmations(status: TRANSACTION_STATUS, limit: number): Promise<TransactionDocument[]> {
        const recentData = new Date(Date.now() - 10000); // 10s ago

        if (random(0, 1) === 0) {
            return await this.transactionModel
                .find({ status, latestSentAt: { $lt: recentData } })
                .sort({ confirmations: 1 })
                .limit(limit);
        }

        return await this.transactionModel
            .find({ status, latestSentAt: { $lt: recentData } })
            .sort({ _id: 1 })
            .limit(limit);
    }

    public async getLatestTransaction(chainId: number, sender: string): Promise<TransactionDocument> {
        return await this.transactionModel.findOne({ chainId, from: sender }).sort({ nonce: -1 });
    }

    public async getLatestTransactionByStatus(chainId: number, sender: string, status?: TRANSACTION_STATUS): Promise<TransactionDocument> {
        return await this.transactionModel.findOne({ chainId, status: status, from: sender }).sort({ nonce: -1 });
    }

    public async getTransactionById(id: string): Promise<TransactionDocument> {
        return await this.transactionModel.findById(id);
    }

    public async getPendingTransactionCountBySigner(chainId: number, signerAddress: string): Promise<number> {
        return await this.transactionModel.countDocuments({
            chainId,
            status: { $in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.LOCAL] },
            from: signerAddress,
        });
    }

    public async getPendingTransactionsBySigner(chainId: number, signerAddress: string): Promise<TransactionDocument[]> {
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
        session?: any,
    ): Promise<TransactionDocument> {
        const tx: TypedTransaction = tryParseSignedTx(signedTx);
        const txHash = `0x${Buffer.from(tx.hash()).toString('hex')}`;

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

        return await transaction.save({ session });
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

    public async updateTransactionStatus(transaction: TransactionDocument, status: TRANSACTION_STATUS) {
        transaction.status = status;
        return await transaction.save();
    }

    public async replaceTransactionTxHash(transaction: TransactionDocument, newSignedTx: string, session?: any) {
        const tx: TypedTransaction = tryParseSignedTx(newSignedTx);
        const newTxHash = `0x${Buffer.from(tx.hash()).toString('hex')}`;
        const newTxData = tx.toJSON();

        const newSignedTxs = transaction.signedTxs;
        newSignedTxs[newTxHash] = newSignedTx;
        const newInner = transaction.inners;
        newInner[newTxHash] = newTxData;
        const newTxHashes = transaction.txHashes.concat(newTxHash);

        return await this.transactionModel.updateOne(
            { _id: transaction.id, status: TRANSACTION_STATUS.PENDING },
            {
                $set: {
                    incrRetry: false,
                    txHashes: newTxHashes,
                    signedTxs: newSignedTxs,
                    inners: newInner,
                    latestSentAt: new Date(),
                },
            },
            { session },
        );
    }
}
