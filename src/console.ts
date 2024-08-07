import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { getAddress } from 'ethers';
import { TransactionService } from './modules/rpc/services/transaction.service';
import { UserOperationService } from './modules/rpc/services/user-operation.service';
import * as pm2 from 'pm2';
import { SERVER_NAME } from './common/common-types';

const nodeIds = [];

pm2.connect(function () {
    pm2.list(function (err, processes) {
        for (const i in processes) {
            if (processes[i].name === SERVER_NAME) {
                nodeIds.push(processes[i].pm_id);
            }
        }
    });
});

// Execute In Pod
// DISABLE_TASK=true ENVIRONMENT=dev node dist/console.js delete-transactions-by-signer chainId signerAddress
// DISABLE_TASK=true ENVIRONMENT=dev node dist/console.js delete-transaction [transactionId]
async function bootstrap() {
    process.env.DISABLE_TASK = 'true';
    process.env.EXECUTE_MODE = 'console';

    const fastifyAdapter = new FastifyAdapter({ ignoreTrailingSlash: true });
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, fastifyAdapter);

    const command = process.argv[2];
    if (command === 'delete-transactions-by-signer') {
        const chainId = Number(process.argv[3]);
        const signerAddress = getAddress(process.argv[4]);

        if (!chainId || !signerAddress) {
            console.error('chainId and signerAddress are required');
            return;
        }

        const transactionService = app.get(TransactionService);
        const userOperationService = app.get(UserOperationService);

        const pendingTransactions = await transactionService.getPendingTransactionsBySigner(chainId, signerAddress);
        for (const pendingTransaction of pendingTransactions) {
            for (const userOperationHash of pendingTransaction.userOperationHashes) {
                const deleted = await userOperationService.deleteUserOperationByUserOpHash(userOperationHash);
                console.log(`Deleted userOperation: ${userOperationHash}, deleted`, deleted);
            }

            console.log('delete pendingTransaction: ', pendingTransaction.id);
            await transactionService.deleteTransactionAndResetUserOperations(pendingTransaction.id);
        }
    } else if (command === 'delete-transaction') {
        const transactionId = process.argv[3];

        if (!transactionId) {
            console.error('transactionId are required');
            return;
        }

        const transactionService = app.get(TransactionService);
        const transaction = await transactionService.getTransactionById(Number(transactionId));
        const userOperationService = app.get(UserOperationService);
        for (const userOperationHash of transaction.userOperationHashes) {
            const deleted = await userOperationService.deleteUserOperationByUserOpHash(userOperationHash);
            console.log(`Deleted userOperation: ${userOperationHash}, deleted`, deleted);
        }

        console.log('delete pendingTransaction: ', transaction.id);
        await transactionService.deleteTransactionAndResetUserOperations(transaction.id);
    } else if (command === 'disable-logger') {
        for (const nodeId of nodeIds) {
            pm2.sendDataToProcessId(
                nodeId,
                {
                    type: 'disable-logger',
                    data: {},
                    topic: true,
                },
                (err, res) => {
                    // nothing
                },
            );
        }
    } else if (command === 'enable-logger') {
        for (const nodeId of nodeIds) {
            pm2.sendDataToProcessId(
                nodeId,
                {
                    type: 'enable-logger',
                    data: {},
                    topic: true,
                },
                (err, res) => {
                    // nothing
                },
            );
        }
    } else {
        console.log('Command not found');
    }

    process.exit(0);
}

bootstrap();
