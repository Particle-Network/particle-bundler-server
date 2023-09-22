import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import FastifyRawBody from 'fastify-raw-body';
import { AppModule } from './app.module';
import { Helper } from './common/helper';
import { ConfigService } from '@nestjs/config';
import { TaskService } from './modules/task/task.service';
import { Alert } from './common/alert';
import { AlertLarkService } from './common/alert-lark';

async function bootstrap() {
    const fastifyAdapter = new FastifyAdapter({ ignoreTrailingSlash: true });
    fastifyAdapter.register(FastifyRawBody as any, {
        field: 'rawBody',
        routes: ['/rpc', '/'],
    });

    const app = await NestFactory.create<NestFastifyApplication>(AppModule, fastifyAdapter);

    app.enableCors({
        origin: '*',
        maxAge: 86400,
    });

    // Mongoose.set('debug', !IS_PRODUCTION);

    const configService = app.get(ConfigService);
    const taskService = app.get(TaskService);

    // Alert.setAlert(new AlertLarkService(process.env.LARK_NOTICE_URL));
    Alert.sendMessage('Particle Bundler Server Started');

    const server = await app.listen(3000, '0.0.0.0');

    process.on('uncaughtException', async (error) => {
        await Alert.sendMessage(Helper.converErrorToString(error), 'Uncaught Exception');

        process.exit(1); // exit application
    });

    process.on('SIGINT', (signal: any) => {
        taskService.stop();

        server.close(async (error: any) => {
            const nodeInstanceId = configService.get('NODE_APP_INSTANCE');
            const err = { error, signal, nodeInstanceId };
            await Alert.sendMessage(Helper.converErrorToString(err), `Server Close`);

            if (error) {
                process.exit(1);
            }
        });

        setTimeout(() => {
            console.log('10s closed');
            process.exit(0);
        }, 10000);
    });
}
bootstrap();
