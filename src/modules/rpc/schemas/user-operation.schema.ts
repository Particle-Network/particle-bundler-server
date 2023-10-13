import { Prop, Schema as NestSchema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema, Types } from 'mongoose';
import { BigNumber } from '../../../common/bignumber';

export enum USER_OPERATION_STATUS {
    TO_BE_REPLACE,
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

    @Prop({ required: true, type: Schema.Types.Mixed })
    public origin: any;

    @Prop({ required: true, type: Schema.Types.Number })
    public status: any;

    @Prop({ required: false, type: Schema.Types.String })
    public txHash: string;

    @Prop({ required: false, type: Schema.Types.String })
    public blockHash: string;

    @Prop({ required: false, type: Schema.Types.Number })
    public blockNumber: number;

    @Prop({ required: false, type: Schema.Types.Date })
    public createdAt: Date;
}

export type UserOperationDocument = UserOperation & Document;
export const UserOperationSchema = SchemaFactory.createForClass(UserOperation);

UserOperationSchema.set('toJSON', {
    transform: function (doc, ret, options) {
        ret._id = ret._id.toString();
        ret.userOpNonce = BigNumber.from(ret.userOpNonce.toString()).toHexString();
        return ret;
    },
});

UserOperationSchema.index(
    {
        chainId: 1,
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
        userOpNonce: 1,
    },
    {
        unique: true,
    },
);

UserOperationSchema.index({
    chainId: 1,
    status: 1,
    userOpHash: 1,
    userOpSender: 1,
    userOpNonce: 1,
});
