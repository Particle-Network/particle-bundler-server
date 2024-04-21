// import { Wallet, Contract, JsonRpcProvider, keccak256 } from 'ethers';
// import { Connection } from 'mongoose';
// import { BLOCK_SIGNER_REASON, keyLockSendingTransaction } from '../../../common/common-types';
// import { Helper } from '../../../common/helper';
// import entryPointAbi from '../aa/abis/entry-point-abi';
// import { TRANSACTION_STATUS, TransactionDocument } from '../schemas/transaction.schema';
// import { UserOperationDocument } from '../schemas/user-operation.schema';
// import { AAService } from '../services/aa.service';
// import LockDe from '../../../common/global-lock';
// import { handleOldPendingTransaction, handlePendingTransaction, tryIncrTransactionGasPrice } from './handle-pending-transactions';
// import { BigNumber } from '../../../common/bignumber';
// import { RpcService } from '../services/rpc.service';
// import { Alert } from '../../../common/alert';
// import { EVM_CHAIN_ID, getSendTransactionMethod, SUPPORT_EIP_1559 } from '../../../configs/bundler-common';
// import { Logger } from '@nestjs/common';
// import { AppException } from '../../../common/app-exception';
// import { ListenerService } from '../../task/listener.service';

// export async function createBundleTransaction(
//     chainId: number,
//     entryPoint: string,
//     mongodbConnection: Connection,
//     provider: JsonRpcProvider,
//     rpcService: RpcService,
//     listenerService: ListenerService,
//     userOperationDocuments: UserOperationDocument[],
//     bundleGasLimit: string,
//     signer: Wallet,
//     nonce: number,
//     feeData: any,
// ) {
//     try {
//         const aaService = rpcService.aaService;
//         const beneficiary = signer.address;
//         const entryPointContract = new Contract(entryPoint, entryPointAbi, provider);
//         const userOps = userOperationDocuments.map((userOperationDocument) => userOperationDocument.origin);
//         let gasLimit = BigNumber.from(bundleGasLimit).mul(15).div(10).toHexString();
//         if ([EVM_CHAIN_ID.MANTLE_MAINNET, EVM_CHAIN_ID.MANTLE_SEPOLIA_TESTNET].includes(chainId)) {
//             gasLimit = BigNumber.from(gasLimit).mul(4).toHexString();
//         }

//         const finalizedTx = await entryPointContract.handleOps.populateTransaction(userOps, beneficiary, {
//             nonce,
//             gasLimit,
//             ...createTxGasData(chainId, feeData),
//         });

//         finalizedTx.chainId = BigInt(chainId);
//         const signedTx = await signer.signTransaction(finalizedTx);

//         let localTransaction: TransactionDocument;
//         await Helper.startMongoTransaction(mongodbConnection, async (session: any) => {
//             const userOpHashes = userOperationDocuments.map((userOperationDocument) => userOperationDocument.userOpHash);
//             localTransaction = await aaService.transactionService.createTransaction(chainId, signedTx, userOpHashes, session);

//             const updateInfo = await aaService.userOperationService.transactionSetSpecialLocalUserOperationsAsPending(
//                 userOperationDocuments,
//                 localTransaction.txHash,
//                 session,
//             );

//             Helper.assertTrue(
//                 updateInfo.modifiedCount === userOperationDocuments.length,
//                 10001,
//                 `Failed to update user operations as pending\n${JSON.stringify(updateInfo)}\n${JSON.stringify(userOpHashes)}`,
//             );
//         });

//         listenerService.appendUserOpHashPendingTransactionMap(localTransaction);

//         // no need to await
//         trySendAndUpdateTransactionStatus(localTransaction, provider, rpcService, aaService, mongodbConnection, true);
//     } catch (error) {
//         if (error instanceof AppException) {
//             throw error;
//         }

//         console.error('Failed to create bundle transaction', error);
//         Alert.sendMessage(`Failed to create bundle transaction: ${Helper.converErrorToString(error)}`);

//         throw error;
//     }
// }

// export async function handleLocalTransaction(
//     mongodbConnection: Connection,
//     localTransaction: TransactionDocument,
//     provider: JsonRpcProvider,
//     rpcService: RpcService,
//     aaService: AAService,
// ) {
//     const receipt = await rpcService.getTransactionReceipt(provider, localTransaction.txHash);
//     if (!!receipt) {
//         await handlePendingTransaction(provider, receipt, mongodbConnection, localTransaction, aaService);

//         return;
//     }

//     trySendAndUpdateTransactionStatus(localTransaction, provider, rpcService, aaService, mongodbConnection);
// }

// export async function trySendAndUpdateTransactionStatus(
//     transaction: TransactionDocument,
//     provider: JsonRpcProvider,
//     rpcService: RpcService,
//     aaService: AAService,
//     mongodbConnection: Connection,
//     skipCheck = false,
// ) {
//     const currentSignedTx = transaction.getCurrentSignedTx();
//     const currentSignedTxHash = keccak256(currentSignedTx);
//     const keyLock = keyLockSendingTransaction(transaction.chainId, currentSignedTxHash);
//     if (LockDe.isAcquired(keyLock)) {
//         Logger.log(`trySendAndUpdateTransactionStatus already acquired; Hash: ${currentSignedTxHash} On Chain ${transaction.chainId}`);
//         return;
//     }

//     await LockDe.acquire(keyLock);
//     Logger.log(`trySendAndUpdateTransactionStatus acquire; Hash: ${currentSignedTxHash} On Chain ${transaction.chainId}`);

//     if (aaService.isBlockedSigner(transaction.chainId, transaction.from)) {
//         Logger.log(
//             `trySendAndUpdateTransactionStatus release isBlockedSigner ${transaction.from} On ${transaction.chainId}; Hash: ${currentSignedTxHash}, TransactionId: ${transaction.id}`,
//         );
//         LockDe.release(keyLock);
//         return;
//     }

//     if (!skipCheck) {
//         transaction = await aaService.transactionService.getTransactionById(transaction.id);
//         if (!transaction.isLocal()) {
//             Logger.log(
//                 `trySendAndUpdateTransactionStatus release !transaction.isLocal(); Hash: ${currentSignedTxHash} On Chain ${transaction.chainId}`,
//             );
//             LockDe.release(keyLock);
//             return;
//         }
//     }

//     try {
//         const r = await provider.send(getSendTransactionMethod(transaction.chainId), [currentSignedTx]);
//         if (!!r?.error) {
//             throw r.error;
//         }
//     } catch (error) {
//         // insufficient funds for intrinsic transaction cost
//         if (error?.message?.toLowerCase()?.includes('insufficient funds')) {
//             aaService.setBlockedSigner(transaction.chainId, transaction.from, BLOCK_SIGNER_REASON.INSUFFICIENT_BALANCE, {
//                 transactionId: transaction.id,
//             });
//         }

//         if (error?.message?.toLowerCase()?.includes('nonce too low')) {
//             // nothing to do
//         }

//         console.error(`SendTransaction error: ${transaction.id}`, error);
//         Alert.sendMessage(
//             `Send Transaction Error On Chain ${transaction.chainId} And Transaction ${transaction.id}: ${Helper.converErrorToString(error)}`,
//         );

//         LockDe.release(keyLock);
//         return;
//     }

//     await aaService.transactionService.updateTransactionStatus(transaction, TRANSACTION_STATUS.PENDING);

//     Logger.log(`trySendAndUpdateTransactionStatus release hash: ${currentSignedTxHash} On Chain ${transaction.chainId}`);
//     LockDe.release(keyLock);
// }

// // TODO: set min fee to ensure the transaction is sent successfully
// export function createTxGasData(chainId: number, feeData: any) {
//     if (!SUPPORT_EIP_1559.includes(chainId)) {
//         return {
//             type: 0,
//             gasPrice: feeData.gasPrice ?? 0,
//         };
//     }

//     return {
//         type: 2,
//         maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0,
//         maxFeePerGas: feeData.maxFeePerGas ?? 0,
//     };
// }

// export async function getReceiptAndHandlePendingTransactions(
//     pendingTransaction: TransactionDocument,
//     rpcService: RpcService,
//     mongodbConnection: Connection,
//     latestTransaction?: TransactionDocument,
// ) {
//     // try {
//     //     // the pending transaction is too old, force to finish it
//     //     if (!!latestTransaction && latestTransaction.nonce > pendingTransaction.nonce && pendingTransaction.isOld()) {
//     //         await handleOldPendingTransaction(pendingTransaction, rpcService.aaService);
//     //         return true;
//     //     }

//     //     const provider = rpcService.getJsonRpcProvider(pendingTransaction.chainId);
//     //     const receiptPromises = pendingTransaction.txHashes.map((txHash) => rpcService.getTransactionReceipt(provider, txHash));
//     //     const receipts = await Promise.all(receiptPromises);

//     //     console.log('getReceiptAndHandlePendingTransactions', receipts.length);
//     //     if (receipts.some((r) => !!r)) {
//     //         console.log(
//     //             'receipts',
//     //             receipts.map((r: any, index: number) => {
//     //                 return {
//     //                     result: !!r,
//     //                     txHash: pendingTransaction.txHashes[index],
//     //                     chainId: pendingTransaction.chainId,
//     //                     from: pendingTransaction.from,
//     //                     nonce: pendingTransaction.nonce,
//     //                 };
//     //             }),
//     //         );
//     //     }

//     //     for (const receipt of receipts) {
//     //         if (!!receipt) {
//     //             await handlePendingTransaction(provider, receipt, mongodbConnection, pendingTransaction, rpcService.aaService);
//     //             return true;
//     //         }
//     //     }

//     //     if (!pendingTransaction.isPendingTimeout()) {
//     //         return false;
//     //     }

//     //     if (
//     //         latestTransaction &&
//     //         latestTransaction.chainId !== EVM_CHAIN_ID.MERLIN_CHAIN_MAINNET &&
//     //         latestTransaction.nonce + 1 === pendingTransaction.nonce
//     //     ) {
//     //         await tryIncrTransactionGasPrice(pendingTransaction, mongodbConnection, provider, rpcService.aaService);
//     //     } else {
//     //         if (pendingTransaction.isOld()) {
//     //             try {
//     //                 await provider.send(getSendTransactionMethod(pendingTransaction.chainId), [pendingTransaction.getCurrentSignedTx()]);
//     //             } catch (error) {
//     //                 console.error('trySendOldPendingTransaction error', error);
//     //                 Alert.sendMessage(
//     //                     `trySendOldPendingTransaction Error On Chain ${pendingTransaction.chainId} For ${
//     //                         pendingTransaction.id
//     //                     }: ${Helper.converErrorToString(error)}`,
//     //                 );
//     //             }
//     //         }
//     //     }

//     //     return false;
//     // } catch (error) {
//     //     Logger.error('getReceiptAndHandlePendingTransactions error', error);

//     //     Alert.sendMessage(
//     //         `getReceiptAndHandlePendingTransactions Error On Chain ${pendingTransaction.chainId} For ${
//     //             pendingTransaction.id
//     //         }: ${Helper.converErrorToString(error)}`,
//     //     );
//     // }
// }
