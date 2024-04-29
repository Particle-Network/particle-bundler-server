import { Prop, Schema as NestSchema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema } from 'mongoose';
import { PENDING_TRANSACTION_EXPIRED_TIME, PENDING_TRANSACTION_WAITING_TIME } from '../../../common/common-types';

export enum TRANSACTION_STATUS {
    LOCAL,
    PENDING,
    DONE,
}

@NestSchema({ versionKey: false, collection: 'transactions', timestamps: true })
export class Transaction {
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
}

export type TransactionDocument = Transaction & Document & ITransactionDocument;
export const TransactionSchema = SchemaFactory.createForClass(Transaction);

interface ITransactionDocument {
    isPendingTimeout(): boolean;
    getCurrentSignedTx(): string;
    isLocal(): boolean;
    isPending(): boolean;
    isDone(): boolean;
    isOld(): boolean;
}

TransactionSchema.set('toJSON', {
    transform: function (doc, ret, options) {
        ret._id = ret._id.toString();
        return ret;
    },
});

TransactionSchema.methods.isPendingTimeout = function (): boolean {
    return (
        [TRANSACTION_STATUS.PENDING].includes(this.status) && Date.now() - this.latestSentAt.valueOf() > PENDING_TRANSACTION_WAITING_TIME * 1000
    );
};

TransactionSchema.methods.isOld = function (): boolean {
    return (
        [TRANSACTION_STATUS.PENDING].includes(this.status) && Date.now() - this.latestSentAt.valueOf() > PENDING_TRANSACTION_EXPIRED_TIME * 1000
    );
};

TransactionSchema.methods.isDone = function (): boolean {
    return [TRANSACTION_STATUS.DONE].includes(this.status);
};

TransactionSchema.methods.isPending = function (): boolean {
    return [TRANSACTION_STATUS.PENDING].includes(this.status);
};

TransactionSchema.methods.isLocal = function (): boolean {
    return [TRANSACTION_STATUS.LOCAL].includes(this.status);
};

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
