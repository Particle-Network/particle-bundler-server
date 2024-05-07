import { Prop, Schema as NestSchema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema, Types } from 'mongoose';
import { toBeHex } from 'ethers';

export enum USER_OPERATION_STATUS {
    LOCAL,
    PENDING,
    DONE,
}

@NestSchema({ versionKey: false, collection: 'user_operations', timestamps: true })
export class UserOperation {
    @Prop({ required: true, type: Schema.Types.Number })
    public chainId: number;

    @Prop({ required: true, type: Schema.Types.String })
    public entryPoint: string;

    @Prop({ required: true, type: Schema.Types.String })
    public userOpHash: string;

    @Prop({ required: true, type: Schema.Types.String })
    public userOpSender: string;

    @Prop({ required: true, type: Schema.Types.Decimal128 })
    public userOpNonce: Types.Decimal128;

    @Prop({ required: true, type: Schema.Types.String })
    public userOpNonceKey: string;

    @Prop({ required: true, type: Schema.Types.Mixed })
    public origin: any;

    @Prop({ required: true, type: Schema.Types.Number })
    public status: any;

    @Prop({ required: false, type: Schema.Types.String })
    public transactionId: string;

    @Prop({ required: false, type: Schema.Types.String })
    public txHash: string; // final confirm tx

    @Prop({ required: false, type: Schema.Types.String })
    public blockHash: string;

    @Prop({ required: false, type: Schema.Types.Number })
    public blockNumber: number;

    @Prop({ required: false, type: Schema.Types.Date })
    public createdAt: Date;

    @Prop({ required: false, type: Schema.Types.Date })
    public updatedAt: Date;
}

export type UserOperationDocument = UserOperation & Document & IUserOperationSchema;
export const UserOperationSchema = SchemaFactory.createForClass(UserOperation);

export interface IUserOperationSchema {
    isOld: () => boolean;
}

UserOperationSchema.set('toJSON', {
    transform: function (doc, ret, options) {
        ret._id = ret._id.toString();
        ret.userOpNonce = toBeHex(ret.userOpNonce.toString());
        return ret;
    },
});

UserOperationSchema.methods.isOld = function (): boolean {
    return this.updatedAt.getTime() < Date.now() - 1000 * 600;
};

UserOperationSchema.index(
    {
        userOpHash: 1,
    },
    {
        unique: true,
    },
);

UserOperationSchema.index(
    {
        chainId: 1,
        userOpSender: 1,
        userOpNonceKey: 1,
        userOpNonce: 1,
    },
    {
        unique: true,
    },
);

UserOperationSchema.index({
    transactionId: 1,
});

UserOperationSchema.index({
    status: 1,
    chainId: 1,
});

UserOperationSchema.index({
    status: 1,
    _id: -1,
});
