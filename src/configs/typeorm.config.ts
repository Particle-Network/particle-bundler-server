import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default class TypeOrmDefaultConfig {
    public static getConfig(configService: ConfigService): TypeOrmModuleOptions {
        return {
            type: 'mysql',
            host: configService.get('DB_HOST'),
            port: parseInt(configService.get('DB_PORT')),
            username: configService.get('DB_USERNAME'),
            password: configService.get('DB_PASSWORD'),
            database: configService.get('DB_DATABASE'),
            autoLoadEntities: true,
            synchronize: false,
            logging: false,
        };
    }
}

export function createTypeOrmConfigAsync(): any {
    return {
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService): Promise<TypeOrmModuleOptions> => TypeOrmDefaultConfig.getConfig(configService),
        inject: [ConfigService],
    };
}
