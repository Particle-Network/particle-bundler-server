import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RpcModule } from '../rpc/rpc.module';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { TransactionService } from '../rpc/services/transaction.service';
import { RpcService } from '../rpc/services/rpc.service';
import { ListenerService } from './listener.service';
import { CommonModule } from '../common/common.module';
import { HandleLocalUserOperationService } from './handle-local-user-operation.service';
import { LarkService } from '../common/services/lark.service';
import { HandlePendingUserOperationService } from './handle-pending-user-operation.service';
import { HandleLocalTransactionService } from './handle-local-transaction.service';
import { HandlePendingTransactionService } from './handle-pending-transaction.service';
import { FillSignerBalanceService } from './fill-signer-balance.service';
import { UnblockAndReleaseSignersService } from './unblock-and-release-signers.service';
import { ChainService } from '../rpc/services/chain.service';
import { SignerService } from '../rpc/services/signer.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserOperationEntity } from '../rpc/entities/user-operation.entity';
import { UserOperationEventEntity } from '../rpc/entities/user-operation-event.entity';
import { TransactionEntity } from '../rpc/entities/transaction.entity';
import { MongooseModule } from '@nestjs/mongoose';
import { UserOperation, UserOperationSchema } from '../rpc/schemas/user-operation.schema';
import { UserOperationEvent, UserOperationEventSchema } from '../rpc/schemas/user-operation-event.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: UserOperation.name, schema: UserOperationSchema },
            { name: UserOperationEvent.name, schema: UserOperationEventSchema },
        ]),
        TypeOrmModule.forFeature([UserOperationEntity, UserOperationEventEntity, TransactionEntity]),
        ScheduleModule.forRoot(),
        CommonModule,
        RpcModule,
    ],
    providers: [
        UnblockAndReleaseSignersService,
        HandleLocalUserOperationService,
        HandlePendingUserOperationService,
        HandleLocalTransactionService,
        HandlePendingTransactionService,
        ListenerService,
        FillSignerBalanceService,
        UserOperationService,
        TransactionService,
        RpcService,
        LarkService,
        ChainService,
        SignerService,
    ],
})
export class TaskModule {}
