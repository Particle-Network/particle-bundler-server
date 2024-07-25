import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModuleAsyncOptions, MongooseModuleOptions } from '@nestjs/mongoose';
import { canRunCron } from '../modules/rpc/aa/utils';

export default class MongodbConfig {
    public static getConfig(configService: ConfigService): MongooseModuleOptions {
        if (canRunCron()) {
            return {
                uri: configService.get('MONGODB_URI'),
                socketTimeoutMS: 360000,
                connectTimeoutMS: 360000,
                retryDelay: 1000,
                retryAttempts: Number.MAX_SAFE_INTEGER,
                maxPoolSize: 500,
                minPoolSize: 100,
            };
        } else {
            return {
                uri: configService.get('MONGODB_URI'),
            };
        }
    }
}

export const mongodbConfigAsync: MongooseModuleAsyncOptions = {
    imports: [ConfigModule],
    useFactory: async (configService: ConfigService): Promise<MongooseModuleOptions> => MongodbConfig.getConfig(configService),
    inject: [ConfigService],
};
