import { RedisModuleAsyncOptions, RedisModuleOptions } from '@liaoliaots/nestjs-redis';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { REDIS_TASK_CONNECTION_NAME } from '../common/common-types';

export default class RedisSDKConfig {
    public static getConfig(configService: ConfigService): RedisModuleOptions {
        return {
            config: [
                {
                    host: configService.get('REDIS_HOST'),
                    port: parseInt(configService.get('REDIS_PORT')),
                    password: configService.get('REDIS_PASSWORD'),
                },
                {
                    namespace: REDIS_TASK_CONNECTION_NAME,
                    host: configService.get('REDIS_TASK_HOST'),
                    port: parseInt(configService.get('REDIS_TASK_PORT')),
                    password: configService.get('REDIS_TASK_PASSWORD'),
                },
            ],
        };
    }
}

export const redisConfigAsync: RedisModuleAsyncOptions = {
    imports: [ConfigModule],
    useFactory: async (configService: ConfigService): Promise<RedisModuleOptions> => RedisSDKConfig.getConfig(configService),
    inject: [ConfigService],
};
