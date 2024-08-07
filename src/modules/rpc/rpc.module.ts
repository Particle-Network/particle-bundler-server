import { Module } from '@nestjs/common';
import { RpcController } from './rpc.controller';
import { RpcService } from './services/rpc.service';
import { UserOperationService } from './services/user-operation.service';
import { MongooseModule } from '@nestjs/mongoose';
import { UserOperation, UserOperationSchema } from './schemas/user-operation.schema';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { UserOperationEvent, UserOperationEventSchema } from './schemas/user-operation-event.schema';
import { TransactionService } from './services/transaction.service';
import { CommonModule } from '../common/common.module';
import { LarkService } from '../common/services/lark.service';
import { SignerService } from './services/signer.service';
import { ChainService } from './services/chain.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserOperationEntity } from './entities/user-operation.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([UserOperationEntity]),
        CommonModule,
        MongooseModule.forFeature([
            { name: UserOperation.name, schema: UserOperationSchema },
            { name: Transaction.name, schema: TransactionSchema },
            { name: UserOperationEvent.name, schema: UserOperationEventSchema },
        ]),
    ],
    controllers: [RpcController],
    providers: [RpcService, UserOperationService, TransactionService, LarkService, SignerService, ChainService],
})
export class RpcModule {}
