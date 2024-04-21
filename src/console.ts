// import { NestFactory } from '@nestjs/core';
// import { AppModule } from './app.module';
// import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
// import { getAddress } from 'ethers';
// import { TransactionService } from './modules/rpc/services/transaction.service';
// import { UserOperationService } from './modules/rpc/services/user-operation.service';

// // Execute In Pod
// // DISABLE_TASK=true ENVIRONMENT=dev node dist/console.js delete-transactions-by-signer chainId signerAddress
// async function bootstrap() {
//     process.env.DISABLE_TASK = 'true';
//     process.env.EXECUTE_MODE = 'console';

//     const fastifyAdapter = new FastifyAdapter({ ignoreTrailingSlash: true });
//     const app = await NestFactory.create<NestFastifyApplication>(AppModule, fastifyAdapter);

//     const command = process.argv[2];
//     if (command === 'delete-transactions-by-signer') {
//         const chainId = Number(process.argv[3]);
//         const signerAddress = getAddress(process.argv[4]);

//         if (!chainId || !signerAddress) {
//             console.error('chainId and signerAddress are required');
//             return;
//         }

//         const transactionService = app.get(TransactionService);
//         const userOperationService = app.get(UserOperationService);

//         const pendingTransactions = await transactionService.getPendingTransactionsBySigner(chainId, signerAddress);
//         for (const pendingTransaction of pendingTransactions) {
//             for (const userOperationHash of pendingTransaction.userOperationHashes) {
//                 const deleted = await userOperationService.deleteUserOperationByUserOpHash(chainId, userOperationHash);
//                 console.log(`Deleted userOperation: ${userOperationHash}, deleted`, deleted);
//             }

//             console.log('delete pendingTransaction: ', pendingTransaction.id);
//             await pendingTransaction.delete();
//         }
//     } else if (command === 'delete-transaction') {
//         const transactionId = process.argv[3];

//         if (!transactionId) {
//             console.error('transactionId are required');
//             return;
//         }

//         const transactionService = app.get(TransactionService);
//         const transaction = await transactionService.getTransactionById(transactionId);
//         const userOperationService = app.get(UserOperationService);
//         for (const userOperationHash of transaction.userOperationHashes) {
//             const deleted = await userOperationService.deleteUserOperationByUserOpHash(transaction.chainId, userOperationHash);
//             console.log(`Deleted userOperation: ${userOperationHash}, deleted`, deleted);
//         }

//         console.log('delete pendingTransaction: ', transaction.id);
//         await transaction.delete();
//     } else {
//         console.log('Command not found');
//     }

//     process.exit(0);
// }

// bootstrap();
