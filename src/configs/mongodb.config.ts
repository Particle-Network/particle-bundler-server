import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModuleAsyncOptions, MongooseModuleOptions } from '@nestjs/mongoose';

export default class MongodbConfig {
    public static getConfig(configService: ConfigService): MongooseModuleOptions {
        return {
            uri: configService.get('MONGODB_URI'),
        };
    }
}

export const mongodbConfigAsync: MongooseModuleAsyncOptions = {
    imports: [ConfigModule],
    useFactory: async (configService: ConfigService): Promise<MongooseModuleOptions> => MongodbConfig.getConfig(configService),
    inject: [ConfigService],
};
