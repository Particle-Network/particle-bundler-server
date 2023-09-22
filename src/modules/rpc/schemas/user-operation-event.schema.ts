import { Prop, Schema as NestSchema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema } from 'mongoose';

@NestSchema({ versionKey: false, collection: 'user_operation_events', timestamps: true })
export class UserOperationEvent {
    @Prop({ required: true, type: Schema.Types.Number })
    public chainId: number;

    @Prop({ required: true, type: Schema.Types.String })
    public contractAddress: string;

    @Prop({ required: true, type: Schema.Types.String })
    public userOperationHash: string;

    @Prop({ required: true, type: Schema.Types.String })
    public txHash: string;

    @Prop({ required: true, type: Schema.Types.String })
    public topic: string;

    @Prop({ required: true, type: Schema.Types.Mixed })
    public args: any;
}

export type UserOperationEventDocument = UserOperationEvent & Document;
export const UserOperationEventSchema = SchemaFactory.createForClass(UserOperationEvent);

UserOperationEventSchema.set('toJSON', {
    transform: function (doc, ret, options) {
        ret._id = ret._id.toString();
        return ret;
    },
});

UserOperationEventSchema.index(
    {
        chainId: 1,
        userOperationHash: 1,
    },
    {
        unique: true,
    },
);
