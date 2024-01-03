import { Contract, JsonRpcProvider } from 'ethers';
import { Connection } from 'mongoose';
import { EVENT_ENTRY_POINT_USER_OPERATION, PROCESS_NOTIFY_TYPE, keyLockPendingTransaction } from '../../../common/common-types';
import { Helper } from '../../../common/helper';
import { TRANSACTION_STATUS, TransactionDocument } from '../schemas/transaction.schema';
import { AAService } from '../services/aa.service';
import Lock from '../../../common/global-lock';
import entryPointAbi from '../aa/entry-point-abi';
import { FeeMarketEIP1559Transaction, TypedTransaction, TransactionFactory, LegacyTransaction } from '@ethereumjs/tx';
import { AppException } from '../../../common/app-exception';
import { Logger } from '@nestjs/common';
import { createTxGasData } from './handle-local-transactions';
import { BigNumber } from '../../../common/bignumber';
import { deepHexlify } from '../aa/utils';
import { Alert } from '../../../common/alert';
import { ProcessNotify } from '../../../common/process-notify';
import { METHOD_SEND_RAW_TRANSACTION } from '../../../configs/bundler-common';

export async function tryIncrTransactionGasPrice(
    transaction: TransactionDocument,
    mongodbConnection: Connection,
    provider: JsonRpcProvider,
    aaService: AAService,
) {
    Logger.log('tryIncrTransactionGasPrice', transaction.id);
    const keyLock = keyLockPendingTransaction(transaction.id);
    if (Lock.isAcquired(keyLock)) {
        Logger.log('tryIncrTransactionGasPrice already acquired', transaction.id);
        return;
    }

    await Lock.acquire(keyLock);
    try {
        const remoteNonce = await aaService.getTransactionCountLocalCache(provider, transaction.chainId, transaction.from, true);
        if (remoteNonce != transaction.nonce) {
            Logger.log('tryIncrTransactionGasPrice release', 'remoteNonce != transaction.nonce', remoteNonce, transaction.nonce);
            Lock.release(keyLock);
            return;
        }
    } catch (error) {
        Alert.sendMessage(
            `TryIncrTransactionGasPrice GetTransactionCount Error On Chain ${transaction.chainId} For ${
                transaction.from
            }: ${Helper.converErrorToString(error)}`,
        );

        Lock.release(keyLock);
        return;
    }

    transaction = await aaService.transactionService.getTransactionById(transaction.id);
    if (!transaction.isPendingTimeout()) {
        Logger.log('tryIncrTransactionGasPrice release', 'transaction is not pending timeout', transaction.id);
        Lock.release(keyLock);
        return;
    }

    const allSigners = aaService.getSigners(transaction.chainId);
    const signer = allSigners.find((signer) => signer.address.toLowerCase() === transaction.from.toLowerCase());
    if (!signer) {
        Logger.log(`Not found signer for ${transaction.from}`);
        Lock.release(keyLock);
        return;
    }

    Logger.log('Try Replace Transaction', transaction.txHash);

    try {
        const coefficient = 1.1;

        const currentSignedTx = transaction.signedTxs[transaction.txHash];
        const tx = tryParseSignedTx(currentSignedTx);
        const txData: any = tx.toJSON();

        const feeData = await aaService.getFeeData(transaction.chainId);

        if (tx instanceof FeeMarketEIP1559Transaction) {
            if (BigNumber.from(feeData.maxFeePerGas).gt(tx.maxFeePerGas)) {
                txData.maxFeePerGas = BigNumber.from(feeData.maxFeePerGas).toHexString();
            }
            if (BigNumber.from(feeData.maxPriorityFeePerGas).gt(tx.maxPriorityFeePerGas)) {
                txData.maxPriorityFeePerGas = BigNumber.from(feeData.maxPriorityFeePerGas).toHexString();
            }

            let bnMaxPriorityFeePerGas = BigNumber.from(tx.maxPriorityFeePerGas);
            let bnMaxFeePerGas = BigNumber.from(tx.maxFeePerGas);
            if (bnMaxPriorityFeePerGas.eq(0)) {
                bnMaxPriorityFeePerGas = bnMaxPriorityFeePerGas.add(0.01 * 10 ** 9);
                if (bnMaxPriorityFeePerGas.gte(bnMaxFeePerGas)) {
                    bnMaxFeePerGas = bnMaxPriorityFeePerGas.add(1);
                }
            }

            txData.maxPriorityFeePerGas = bnMaxPriorityFeePerGas
                .mul(coefficient * 10)
                .div(10)
                .toHexString();
            txData.maxFeePerGas = bnMaxFeePerGas
                .mul(coefficient * 10)
                .div(10)
                .toHexString();

            Logger.log(
                `Replace Transaction, Old maxPriorityFeePerGas: ${tx.maxPriorityFeePerGas}, New maxPriorityFeePerGas: ${txData.maxPriorityFeePerGas}`,
            );
        }

        if (tx instanceof LegacyTransaction) {
            if (BigNumber.from(feeData.gasPrice).gt(tx.gasPrice)) {
                txData.gasPrice = BigNumber.from(feeData.gasPrice).toHexString();
            }

            txData.gasPrice = BigNumber.from(tx.gasPrice)
                .mul(coefficient * 10)
                .div(10)
                .toHexString();

            Logger.log(`Replace Transaction, Old gasPrice: ${tx.gasPrice}, New gasPrice: ${txData.gasPrice}`);
        }

        const signedTx = await signer.signTransaction({
            chainId: transaction.chainId,
            to: txData.to,
            data: txData.data,
            nonce: txData.nonce,
            gasLimit: txData.gasLimit,
            ...createTxGasData(transaction.chainId, txData),
        });

        const rTxHash = await provider.send(METHOD_SEND_RAW_TRANSACTION, [signedTx]);
        if (!!rTxHash?.error) {
            throw rTxHash.error;
        }

        const txHash = typeof rTxHash === 'string' ? rTxHash : rTxHash.result;

        Logger.log('New TxHash', rTxHash);
        Logger.log('New SignedTxs', signedTx);

        if (!!txHash) {
            // should update user ops tx hash ???
            await Helper.startMongoTransaction(mongodbConnection, async (session: any) => {
                await aaService.transactionService.replaceTransactionTxHash(transaction, txHash, signedTx, txData, session);
            });
        }
    } catch (error) {
        Logger.error(`Replace Transaction error on chain ${transaction.chainId}`, error, transaction);

        error.transaction = transaction.toJSON();
        Alert.sendMessage(
            `ReplaceTransaction Error On Chain ${transaction.chainId} For ${transaction.from}: ${Helper.converErrorToString(error)}`,
        );

        Lock.release(keyLock);
        return;
    }

    Logger.log('tryIncrTransactionGasPrice release', transaction.id);
    Lock.release(keyLock);
}

export async function handlePendingTransaction(
    provider: JsonRpcProvider,
    receipt: any,
    mongodbConnection: Connection,
    transaction: TransactionDocument,
    aaService: AAService,
) {
    if (!receipt) {
        return;
    }

    ProcessNotify.sendMessages(PROCESS_NOTIFY_TYPE.SET_RECEIPT, {
        chainId: transaction.chainId,
        userOpHashes: transaction.userOperationHashes,
        receipt,
    });

    const keyLock = keyLockPendingTransaction(transaction.id);
    if (Lock.isAcquired(keyLock)) {
        Logger.log('handlePendingTransaction already acquired', transaction.id);
        return;
    }

    Logger.log('handlePendingTransaction before acquire', transaction.id);
    await Lock.acquire(keyLock);
    Logger.log('handlePendingTransaction after acquire', transaction.id);

    transaction = await aaService.transactionService.getTransactionById(transaction.id);
    if (transaction.isDone()) {
        Logger.log('handlePendingTransaction release in advance');
        Lock.release(keyLock);
        return;
    }

    const chainId = transaction.chainId;
    const results = await checkAndHandleFailedReceipt(receipt, provider, transaction.userOperationHashes);
    for (const { receipt, userOpHashes } of results) {
        Logger.log('Transaction done', receipt.transactionHash, userOpHashes);

        const contract = new Contract(receipt.to, entryPointAbi);
        for (const log of receipt?.logs ?? []) {
            try {
                const parsed = contract.interface.parseLog(log);
                if (parsed?.name !== 'UserOperationEvent') {
                    continue;
                }

                const args = deepHexlify(parsed.args);
                await aaService.userOperationService.createOrGetUserOperationEvent(
                    chainId,
                    parsed.args.userOpHash,
                    receipt.transactionHash,
                    receipt.to,
                    parsed.topic,
                    args,
                );
            } catch (error) {
                // May not be an EntryPoint event.
                continue;
            }
        }

        Logger.log('receipt', receipt);

        const status = BigNumber.from(receipt.status).eq(1) ? TRANSACTION_STATUS.SUCCESS : TRANSACTION_STATUS.FAILED;
        const blockHash = receipt.blockHash;
        const blockNumber = receipt.blockNumber;

        try {
            await Helper.startMongoTransaction(mongodbConnection, async (session: any) => {
                let targetTransaction = transaction;
                if (!transaction.txHashes.includes(receipt.transactionHash)) {
                    targetTransaction = await aaService.transactionService.getTransaction(chainId, receipt.transactionHash);
                    if (!targetTransaction) {
                        targetTransaction = await aaService.transactionService.createDoneTransaction(
                            chainId,
                            userOpHashes,
                            receipt,
                            receipt.transactionHash,
                            receipt.from,
                            receipt.to,
                            -1,
                            status,
                            session,
                        );
                    }
                }

                targetTransaction.blockNumber = blockNumber;
                targetTransaction.blockHash = blockHash;
                targetTransaction.txHash = receipt.transactionHash;
                targetTransaction.receipt = deepHexlify(receipt);

                await aaService.transactionService.updateTransactionStatus(targetTransaction, status, session);

                await aaService.userOperationService.transactionSetUserOperationsAsDone(
                    chainId,
                    userOpHashes,
                    targetTransaction.txHash,
                    blockNumber,
                    blockHash,
                    session,
                );
            });
        } catch (error) {
            Logger.error('SetUserOperationsAsDone error', error);
            Alert.sendMessage(
                `SetUserOperationsAsDone Error On Chain ${transaction.chainId} For ${transaction.from}: ${Helper.converErrorToString(
                    error,
                )}\nUserOpHashes: ${JSON.stringify(userOpHashes)}\nTransactionId:${transaction.id}`,
            );
        }

        // wait for 3 seconds to avoid write conflict
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    Logger.log('handlePendingTransaction final release', keyLock);
    Lock.release(keyLock);
}

export async function handleOldPendingTransaction(transaction: TransactionDocument, aaService: AAService) {
    await aaService.transactionService.updateTransactionStatus(transaction, TRANSACTION_STATUS.SUCCESS);
    const userOpHashes = transaction.userOperationHashes;
    await aaService.userOperationService.transactionSetUserOperationsAsDone(transaction.chainId, userOpHashes, '', 0, '', null);
}

// check is the userop is bundled by other tx(mev)
export async function checkAndHandleFailedReceipt(receipt: any, provider: JsonRpcProvider, targetUserOpHashes: string[]) {
    try {
        if (BigNumber.from(receipt.status).eq(1)) {
            return [{ receipt, userOpHashes: targetUserOpHashes }];
        }

        const logs = await provider.getLogs({
            fromBlock: BigNumber.from(receipt.blockNumber).sub(20).toHexString(),
            toBlock: BigNumber.from(receipt.blockNumber).toHexString(),
            topics: [EVENT_ENTRY_POINT_USER_OPERATION],
        });

        const txHashes = {};
        for (const log of logs) {
            const userOpHash = log.topics[1];
            if (targetUserOpHashes.includes(userOpHash.toLowerCase())) {
                if (!txHashes[log.transactionHash]) {
                    txHashes[log.transactionHash] = [];
                }

                txHashes[log.transactionHash].push(userOpHash);
            }
        }

        // if no matched tx, it means this is a normal failed op
        if (Object.keys(txHashes).length === 0) {
            return [{ receipt, userOpHashes: targetUserOpHashes }];
        }

        if (!txHashes[receipt.transactionHash]) {
            txHashes[receipt.transactionHash] = [];
        }

        const receipts = await Promise.all(
            Object.keys(txHashes).map(async (txHash) => {
                if (txHash === receipt.transactionHash) {
                    return receipt;
                }

                return await provider.send('eth_getTransactionReceipt', [txHash]);
            }),
        );

        const results = [];
        for (const receipt of receipts) {
            results.push({
                receipt,
                userOpHashes: txHashes[receipt.transactionHash],
            });
        }

        return results;
    } catch (error) {
        Logger.error('checkAndHandleFailedReceipt error', error);
        Alert.sendMessage(`CheckAndHandleFailedReceipt Error: ${Helper.converErrorToString(error)}`);

        return [{ receipt, userOpHashes: targetUserOpHashes }];
    }
}

export function tryParseSignedTx(signedTx: string): TypedTransaction {
    let tx: TypedTransaction;
    try {
        tx = TransactionFactory.fromSerializedData(Buffer.from(signedTx.substring(2), 'hex'));
    } catch (error) {
        throw new AppException(10002, `Invalid transaction: ${error.message}`);
    }

    return tx;
}
