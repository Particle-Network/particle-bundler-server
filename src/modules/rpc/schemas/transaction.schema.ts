import { Prop, Schema as NestSchema, SchemaFactory } from '@nestjs/mongoose';
import { Document, ObjectId, Schema } from 'mongoose';
import {
    PENDING_TRANSACTION_EXPIRED_TIME,
    PENDING_TRANSACTION_WAITING_TIME,
    PENDING_TRANSACTION_ABANDON_TIME,
} from '../../../common/common-types';

export enum TRANSACTION_STATUS {
    LOCAL,
    PENDING,
    DONE,
}

@NestSchema({ versionKey: false, collection: 'transactions', timestamps: true })
export class Transaction {
    @Prop({ required: true, type: Schema.Types.ObjectId })
    public _id: ObjectId;

    @Prop({ required: true, type: Schema.Types.Number })
    public chainId: number;

    @Prop({ required: true, type: Schema.Types.String })
    public from: string;

    @Prop({ required: true, type: Schema.Types.String })
    public to: string;

    @Prop({ required: true, type: Schema.Types.Number })
    public nonce: number;

    @Prop({ required: true, type: Schema.Types.Array })
    public userOperationHashes: string[];

    @Prop({ required: true, type: Schema.Types.Mixed })
    public signedTxs: any; // save all signedTxs

    @Prop({ required: true, type: Schema.Types.Mixed })
    public inners: any;

    @Prop({ required: true, type: Schema.Types.Number })
    public status: number;

    @Prop({ required: true, type: Schema.Types.Array })
    public txHashes: string[]; // save all txHashes

    @Prop({ required: true, type: Schema.Types.Number })
    public confirmations: number;

    @Prop({ required: true, type: Schema.Types.Boolean })
    public incrRetry: boolean; // can edit by console

    @Prop({ required: false, type: Schema.Types.Mixed })
    public receipts: any;

    @Prop({ required: false, type: Schema.Types.Mixed })
    public userOperationHashMapTxHash: any;

    @Prop({ required: true, type: Schema.Types.Date })
    public latestSentAt: Date;

    @Prop({ required: false, type: Schema.Types.Date })
    public createdAt: Date;

    @Prop({ required: false, type: Schema.Types.Date })
    public updatedAt: Date;
}

export type TransactionDocument = Transaction & Document;
export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.set('toJSON', {
    transform: function (doc, ret, options) {
        ret._id = ret._id.toString();
        return ret;
    },
});

export function isPendingTimeout(transaction: Transaction): boolean {
    return (
        [TRANSACTION_STATUS.PENDING].includes(transaction.status) &&
        Date.now() - new Date(transaction.latestSentAt).valueOf() > PENDING_TRANSACTION_WAITING_TIME * 1000
    );
}

export function isOld(transaction: Transaction): boolean {
    return (
        [TRANSACTION_STATUS.PENDING].includes(transaction.status) &&
        Date.now() - new Date(transaction.latestSentAt).valueOf() > PENDING_TRANSACTION_EXPIRED_TIME * 1000
    );
}

export function isTooOld(transaction: Transaction): boolean {
    return (
        [TRANSACTION_STATUS.PENDING].includes(transaction.status) &&
        Date.now() - new Date(transaction.createdAt).valueOf() > PENDING_TRANSACTION_ABANDON_TIME * 1000
    );
}

TransactionSchema.index(
    {
        chainId: 1,
        from: 1,
        nonce: 1,
    },
    {
        unique: true,
    },
);

TransactionSchema.index({
    chainId: 1,
    status: 1,
    from: 1,
});

TransactionSchema.index({
    status: 1,
    latestSentAt: 1,
    confirmations: 1,
});

TransactionSchema.index({
    status: 1,
    latestSentAt: 1,
    _id: 1,
});
