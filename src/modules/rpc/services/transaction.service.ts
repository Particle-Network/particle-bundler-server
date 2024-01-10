import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TRANSACTION_STATUS, Transaction, TransactionDocument } from '../schemas/transaction.schema';
import { TypedTransaction } from '@ethereumjs/tx';
import { tryParseSignedTx } from '../shared/handle-pending-transactions';
import { getAddress } from 'ethers';
import { BigNumber } from '../../../common/bignumber';

@Injectable()
export class TransactionService {
    public constructor(@InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>) {}

    public async getTransaction(chainId: number, txHash: string): Promise<TransactionDocument> {
        return await this.transactionModel.findOne({ chainId, txHash });
    }

    public async getTransactionsByStatus(status: TRANSACTION_STATUS, limit: number): Promise<TransactionDocument[]> {
        return await this.transactionModel.find({ status }).sort({ from: 1, nonce: 1 }).limit(limit);
    }

    public async getLatestTransaction(chainId: number, sender: string, statuses?: TRANSACTION_STATUS[]): Promise<TransactionDocument> {
        if (statuses) {
            return await this.transactionModel.findOne({ chainId, from: sender, status: { $in: statuses } }).sort({ nonce: -1 });
        }

        return await this.transactionModel.findOne({ chainId, from: sender }).sort({ nonce: -1 });
    }

    public async getTransactionById(id: string): Promise<TransactionDocument> {
        return await this.transactionModel.findById(id);
    }

    public async getPendingTransactionCountBySigner(chainId: number, signerAddress: string): Promise<number> {
        return await this.transactionModel.countDocuments({
            chainId,
            from: signerAddress,
            status: { $in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.LOCAL] },
        });
    }

    public async createTransaction(chainId: number, signedTx: any, userOperationHashes: string[], session: any): Promise<TransactionDocument> {
        const tx: TypedTransaction = tryParseSignedTx(signedTx);
        const txHash = `0x${Buffer.from(tx.hash()).toString('hex')}`;

        const transaction = new this.transactionModel({
            chainId,
            from: getAddress(tx.getSenderAddress().toString()),
            to: getAddress(tx.to.toString()),
            nonce: BigNumber.from(tx.nonce).toNumber(),
            userOperationHashes,
            inner: { [txHash]: tx.toJSON() },
            signedTxs: { [txHash]: signedTx },
            status: TRANSACTION_STATUS.LOCAL,
            txHash, // calculate tx hash in advance
            txHashes: [txHash],
            latestSentAt: new Date(),
        });

        return await transaction.save({ session });
    }

    public async createDoneTransaction(
        chainId: number,
        userOperationHashes: string[],
        txData: any,
        txHash: string,
        from: string,
        to: string,
        nonce: any,
        status: TRANSACTION_STATUS,
        session: any,
    ): Promise<TransactionDocument> {
        const transaction = new this.transactionModel({
            chainId,
            from: getAddress(from),
            to: getAddress(to),
            nonce: BigNumber.from(nonce).toNumber(),
            userOperationHashes,
            inner: { [txHash]: txData },
            signedTxs: { [txHash]: '' },
            status,
            txHash, // calculate tx hash in advance
            txHashes: [txHash],
            latestSentAt: new Date(),
        });

        return await transaction.save({ session });
    }

    public async updateTransactionStatus(transaction: TransactionDocument, status: TRANSACTION_STATUS, session?: any) {
        transaction.status = status;
        return await transaction.save({ session });
    }

    public async replaceTransactionTxHash(transaction: TransactionDocument, newTxHash: string, newSignedTx: string, txData: any, session?: any) {
        const newSignedTxs = transaction.signedTxs;
        newSignedTxs[newTxHash] = newSignedTx;

        const newInner = transaction.inner;
        newInner[newTxHash] = txData;

        const newTxHashes = transaction.txHashes.concat(newTxHash);

        return await this.transactionModel.updateOne(
            { _id: transaction.id, status: TRANSACTION_STATUS.PENDING },
            {
                $set: {
                    txHash: newTxHash,
                    txHashes: newTxHashes,
                    signedTx: newSignedTx,
                    signedTxs: newSignedTxs,
                    inner: newInner,
                    latestSentAt: new Date(),
                },
            },
            { session },
        );
    }
}
