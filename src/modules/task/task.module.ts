import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RpcModule } from '../rpc/rpc.module';
import { TaskService } from './task.service';
import { AAService } from '../rpc/services/aa.service';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { UserOperation, UserOperationSchema } from '../rpc/schemas/user-operation.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { UserOperationEvent, UserOperationEventSchema } from '../rpc/schemas/user-operation-event.schema';
import { Transaction, TransactionSchema } from '../rpc/schemas/transaction.schema';
import { TransactionService } from '../rpc/services/transaction.service';
import { RpcService } from '../rpc/services/rpc.service';
import { ListenerService } from './listener.service';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        RpcModule,
        MongooseModule.forFeature([
            { name: UserOperation.name, schema: UserOperationSchema },
            { name: Transaction.name, schema: TransactionSchema },
            { name: UserOperationEvent.name, schema: UserOperationEventSchema },
        ]),
    ],
    providers: [TaskService, ListenerService, AAService, UserOperationService, TransactionService, RpcService],
})
export class TaskModule {}
