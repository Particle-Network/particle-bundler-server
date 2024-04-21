import { Module } from '@nestjs/common';
import { CommonModule } from './modules/common/common.module';
import { RpcModule } from './modules/rpc/rpc.module';
import { configConfig } from './configs/config.config';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { mongodbConfigAsync } from './configs/mongodb.config';

@Module({
    imports: [ConfigModule.forRoot(configConfig), MongooseModule.forRootAsync(mongodbConfigAsync), CommonModule, RpcModule],
})
export class AppModule {}
