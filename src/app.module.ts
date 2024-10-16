import { Module } from '@nestjs/common';
import { CommonModule } from './modules/common/common.module';
import { RpcModule } from './modules/rpc/rpc.module';
import { configConfig } from './configs/config.config';
import { ConfigModule } from '@nestjs/config';
import { TaskModule } from './modules/task/task.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createTypeOrmConfigAsync } from './configs/typeorm.config';

@Module({
    imports: [ConfigModule.forRoot(configConfig), CommonModule, RpcModule, TaskModule, TypeOrmModule.forRootAsync(createTypeOrmConfigAsync())],
})
export class AppModule {}
