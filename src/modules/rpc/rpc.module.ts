import { Module } from '@nestjs/common';
import { RpcController } from './rpc.controller';
import { RpcService } from './services/rpc.service';
import { UserOperationService } from './services/user-operation.service';
import { TransactionService } from './services/transaction.service';
import { CommonModule } from '../common/common.module';
import { LarkService } from '../common/services/lark.service';
import { SignerService } from './services/signer.service';
import { ChainService } from './services/chain.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserOperationEntity } from './entities/user-operation.entity';
import { UserOperationEventEntity } from './entities/user-operation-event.entity';
import { TransactionEntity } from './entities/transaction.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([UserOperationEntity, UserOperationEventEntity, TransactionEntity]),
        CommonModule,
    ],
    controllers: [RpcController],
    providers: [RpcService, UserOperationService, TransactionService, LarkService, SignerService, ChainService],
})
export class RpcModule {}
