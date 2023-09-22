import { Wallet, Contract, JsonRpcProvider } from 'ethers';
import { Connection } from 'mongoose';
import { EVENT_ENTRY_POINT_USER_OPERATION, keyLockPendingTransaction } from '../../../common/common-types';
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
import { getPrivateKeyByAddress } from '../../../configs/bundler-config';
import { deepHexlify } from '../aa/utils';
import { Alert } from '../../../common/alert';

export async function tryIncrTransactionGasPrice(
    transaction: TransactionDocument,
    mongodbConnection: Connection,
    provider: JsonRpcProvider,
    aaService: AAService,
) {
    console.log('tryIncrTransactionGasPrice', transaction.id);
    const keyLock = keyLockPendingTransaction(transaction.id);
    if (Lock.isAcquired(keyLock)) {
        console.log('tryIncrTransactionGasPrice already acquired', transaction.id);
        return;
    }

    await Lock.acquire(keyLock);
    const remoteNonce = await provider.getTransactionCount(transaction.from, 'latest');
    if (remoteNonce != transaction.nonce) {
        console.log('tryIncrTransactionGasPrice release', 'remoteNonce != transaction.nonce', remoteNonce, transaction.nonce);
        Lock.release(keyLock);
        return;
    }

    transaction = await aaService.transactionService.getTransactionById(transaction.id);
    if (!transaction.isPendingTimeout()) {
        console.log('tryIncrTransactionGasPrice release', 'transaction is not pending timeout', transaction.id);
        Lock.release(keyLock);
        return;
    }

    console.log('Try Replace Transaction', transaction.txHash);

    try {
        const coefficient = 1.1;

        const currentSignedTx = transaction.signedTxs[transaction.txHash];
        const tx = tryParseSignedTx(currentSignedTx);
        const txData: any = tx.toJSON();

        if (tx instanceof FeeMarketEIP1559Transaction) {
            txData.maxFeePerGas = BigNumber.from(tx.maxFeePerGas)
                .mul(coefficient * 10)
                .div(10)
                .toHexString();

            console.log(`Replace Transaction, Old maxPriorityFeePerGas: ${tx.maxFeePerGas}, New maxPriorityFeePerGas: ${txData.maxFeePerGas}`);
        }

        if (tx instanceof LegacyTransaction) {
            txData.gasPrice = BigNumber.from(tx.gasPrice)
                .mul(coefficient * 10)
                .div(10)
                .toHexString();

            console.log(`Replace Transaction, Old gasPrice: ${tx.gasPrice}, New gasPrice: ${txData.gasPrice}`);
        }

        const signer = new Wallet(getPrivateKeyByAddress(transaction.from));
        const signedTx = await signer.signTransaction({
            chainId: transaction.chainId,
            to: txData.to,
            data: txData.data,
            nonce: txData.nonce,
            gasLimit: txData.gasLimit,
            ...createTxGasData(transaction.chainId, txData),
        });

        const rTxHash = await provider.broadcastTransaction(signedTx);
        const txHash = typeof rTxHash === 'string' ? rTxHash : rTxHash.hash;

        console.log('New TxHash', txHash);
        console.log('New SignedTxs', signedTx);

        // should update user ops tx hash ???
        await Helper.startMongoTransaction(mongodbConnection, async (session: any) => {
            await aaService.transactionService.replaceTransactionTxHash(transaction, txHash, signedTx, txData, session);
        });
    } catch (error) {
        console.error('Replace Transaction error', error);

        error.transaction = transaction.toJSON();
        Alert.sendMessage(`ReplaceTransaction Error: ${Helper.converErrorToString(error)}`);

        Lock.release(keyLock);
        return;
    }

    console.log('tryIncrTransactionGasPrice release', transaction.id);
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

    const keyLock = keyLockPendingTransaction(transaction.id);
    if (Lock.isAcquired(keyLock)) {
        console.log('handlePendingTransaction already acquired', transaction.id);
        return;
    }

    console.log('handlePendingTransaction before acquire', transaction.id);
    await Lock.acquire(keyLock);
    console.log('handlePendingTransaction after acquire', transaction.id);

    transaction = await aaService.transactionService.getTransactionById(transaction.id);
    if (transaction.isDone()) {
        console.log('handlePendingTransaction release in advance');
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

        console.log('receipt', receipt);

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
                    userOpHashes,
                    targetTransaction.txHash,
                    blockNumber,
                    blockHash,
                    session,
                );
            });
        } catch (error) {
            console.error('SetUserOperationsAsDone error', error);
            Alert.sendMessage(`SetUserOperationsAsDone Error: ${Helper.converErrorToString(error)}`);
        }
    }

    console.log('handlePendingTransaction final release', keyLock);
    Lock.release(keyLock);
}

// check is the userop is bundled by other tx(mev)
export async function checkAndHandleFailedReceipt(receipt: any, provider: JsonRpcProvider, targetUserOpHashes: string[]) {
    if (BigNumber.from(receipt.status).eq(1)) {
        return [{ receipt, userOpHashes: targetUserOpHashes }];
    }

    try {
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
        console.error('checkAndHandleFailedReceipt error', error);
        Alert.sendMessage(`checkAndHandleFailedReceipt Error: ${Helper.converErrorToString(error)}`);

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
