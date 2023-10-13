import { Prop, Schema as NestSchema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema } from 'mongoose';
import { PENDING_TRANSACTION_WAITING_TIME } from '../../../common/common-types';

export enum TRANSACTION_STATUS {
    LOCAL,
    PENDING,
    SUCCESS,
    FAILED,
}

@NestSchema({ versionKey: false, collection: 'transactions', timestamps: true })
export class Transaction {
    @Prop({ required: true, type: Schema.Types.Number })
    public chainId: number;

    @Prop({ required: true, type: Schema.Types.Array })
    public userOperationHashes: string[];

    @Prop({ required: true, type: Schema.Types.String })
    public from: string;

    @Prop({ required: true, type: Schema.Types.String })
    public to: string;

    @Prop({ required: true, type: Schema.Types.Number })
    public nonce: number;

    @Prop({ required: true, type: Schema.Types.Mixed })
    public signedTxs: any; // save all signedTxs

    @Prop({ required: true, type: Schema.Types.Mixed })
    public inner: any;

    @Prop({ required: true, type: Schema.Types.Number })
    public status: number;

    @Prop({ required: true, type: Schema.Types.String })
    public txHash: string; // current txHash

    @Prop({ required: true, type: Schema.Types.Array })
    public txHashes: string[]; // save all txHashes

    @Prop({ required: false, type: Schema.Types.String })
    public blockHash: string;

    @Prop({ required: false, type: Schema.Types.Number })
    public blockNumber: number;

    @Prop({ required: false, type: Schema.Types.Mixed })
    public receipt: any;

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

TransactionSchema.methods.getCurrentSignedTx = function (): string {
    return this.signedTxs[this.txHash];
};

TransactionSchema.methods.isDone = function (): boolean {
    return [TRANSACTION_STATUS.FAILED, TRANSACTION_STATUS.SUCCESS].includes(this.status);
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
        txHash: 1,
    },
    {
        unique: true,
    },
);

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
    status: 1,
    from: 1,
    nonce: 1,
});

TransactionSchema.index({
    chainId: 1,
    from: 1,
    status: 1,
});
