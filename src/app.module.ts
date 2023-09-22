import { Module } from '@nestjs/common';
import { CommonModule } from './modules/common/common.module';
import { RpcModule } from './modules/rpc/rpc.module';
import { configConfig } from './configs/config.config';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { mongodbConfigAsync } from './configs/mongodb.config';
import { TaskModule } from './modules/task/task.module';
import { Http2Module } from './http2/http2.module';
import { redisConfigAsync } from './configs/redis.config';
import { RedisModule } from '@liaoliaots/nestjs-redis';

@Module({
    imports: [
        ConfigModule.forRoot(configConfig),
        MongooseModule.forRootAsync(mongodbConfigAsync),
        RedisModule.forRootAsync(redisConfigAsync),
        CommonModule,
        RpcModule,
        TaskModule,
        Http2Module,
    ],
})
export class AppModule {}
