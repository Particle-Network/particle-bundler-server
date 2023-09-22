import { Module } from '@nestjs/common';
import { RpcController } from './rpc.controller';
import { RpcService } from './services/rpc.service';
import { AAService } from './services/aa.service';
import { UserOperationService } from './services/user-operation.service';
import { MongooseModule } from '@nestjs/mongoose';
import { UserOperation, UserOperationSchema } from './schemas/user-operation.schema';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { UserOperationEvent, UserOperationEventSchema } from './schemas/user-operation-event.schema';
import { TransactionService } from './services/transaction.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: UserOperation.name, schema: UserOperationSchema },
            { name: Transaction.name, schema: TransactionSchema },
            { name: UserOperationEvent.name, schema: UserOperationEventSchema },
        ]),
    ],
    controllers: [RpcController],
    providers: [RpcService, AAService, UserOperationService, TransactionService],
})
export class RpcModule {}
