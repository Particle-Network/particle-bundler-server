import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import {
    BLOCK_SIGNER_REASON,
    EVENT_ENTRY_POINT_USER_OPERATION,
    IUserOperationEventObject,
    keyLockPendingTransaction,
    keyLockSendingTransaction,
} from '../../common/common-types';
import { TRANSACTION_STATUS, TransactionDocument } from '../rpc/schemas/transaction.schema';
import { TransactionService } from '../rpc/services/transaction.service';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { getBundlerChainConfig, onEmitUserOpEvent } from '../../configs/bundler-common';
import { Contract, toBeHex } from 'ethers';
import entryPointAbi from '../rpc/aa/abis/entry-point-abi';
import { canRunCron, createTxGasData, deepHexlify, getDocumentId, tryParseSignedTx } from '../rpc/aa/utils';
import { Cron } from '@nestjs/schedule';
import { FeeMarketEIP1559Transaction, LegacyTransaction } from '@ethereumjs/tx';
import { SignerService } from '../rpc/services/signer.service';
import { ChainService } from '../rpc/services/chain.service';

@Injectable()
export class HandlePendingTransactionService {
    private readonly lockSendingTransactions: Set<string> = new Set();
    private readonly lockPendingTransactions: Set<string> = new Set();

    public constructor(
        @InjectConnection() private readonly connection: Connection,
        private readonly larkService: LarkService,
        private readonly transactionService: TransactionService,
        private readonly userOperationService: UserOperationService,
        private readonly signerService: SignerService,
        private readonly chainService: ChainService,
    ) {}

    @Cron('* * * * * *')
    public async handleRecentPendingTransactions() {
        if (!canRunCron()) {
            return;
        }

        let pendingTransactions = await this.transactionService.getRecentTransactionsByStatusSortConfirmations(TRANSACTION_STATUS.PENDING, 500);

        if (new Date().getSeconds() % 5 === 0) {
            const longPendingTransactions = await this.transactionService.getLongAgoTransactionsByStatusSortConfirmations(
                TRANSACTION_STATUS.PENDING,
                500,
            );

            pendingTransactions = pendingTransactions.concat(longPendingTransactions);
        }

        // async execute, no need to wait
        this.handlePendingTransactionsAction(pendingTransactions);
    }

    private async handlePendingTransactionsAction(pendingTransactions: TransactionDocument[]) {
        const promises = [];
        for (const pendingTransaction of pendingTransactions) {
            promises.push(this.getReceiptAndHandlePendingTransactions(pendingTransaction));
        }

        const transactionsAddConfirmations = (await Promise.all(promises)).filter((t) => !!t);
        this.transactionService.addTransactionsConfirmations(transactionsAddConfirmations.map((t) => getDocumentId(t)));
    }

    // There is a concurrency conflict and locks need to be added
    public async trySendAndUpdateTransactionStatus(transaction: TransactionDocument, txHash: string) {
        if (!transaction.signedTxs[txHash]) {
            return;
        }

        if (this.signerService.isBlockedSigner(transaction.chainId, transaction.from)) {
            return;
        }

        const keyLock = keyLockSendingTransaction(getDocumentId(transaction));
        if (this.lockSendingTransactions.has(keyLock)) {
            return;
        }

        this.lockSendingTransactions.add(keyLock);

        try {
            // It's possible that when you grab the lock, the previous call has already been made, so you need to check it again
            transaction = await this.transactionService.getTransactionById(getDocumentId(transaction));
            if (!transaction || !transaction.isLocal()) {
                this.lockSendingTransactions.delete(keyLock);
                return;
            }

            await this.chainService.sendRawTransaction(transaction.chainId, transaction.signedTxs[txHash]);
        } catch (error) {
            if (error?.message?.toLowerCase()?.includes('already known')) {
                // already send ?? can skip
            } else {
                // insufficient funds for intrinsic transaction cost
                if (error?.message?.toLowerCase()?.includes('insufficient funds')) {
                    this.signerService.setBlockedSigner(transaction.chainId, transaction.from, BLOCK_SIGNER_REASON.INSUFFICIENT_BALANCE, {
                        transactionId: getDocumentId(transaction),
                    });
                } else if (
                    error?.message?.toLowerCase()?.includes('nonce too low') ||
                    error?.message?.toLowerCase()?.includes('replacement transaction underpriced')
                ) {
                    // delete transaction and recover user op
                    this.chainService.trySetTransactionCountLocalCache(transaction.chainId, transaction.from, transaction.nonce + 1);
                    await Helper.startMongoTransaction(this.connection, async (session: any) => {
                        await Promise.all([
                            transaction.delete({ session }),
                            this.userOperationService.setPendingUserOperationsToLocal(getDocumentId(transaction), session),
                        ]);
                    });
                }

                Logger.error(`SendTransaction error: ${getDocumentId(transaction)}`, error);
                this.larkService.sendMessage(
                    `Send Transaction Error On Chain ${transaction.chainId} And Transaction ${getDocumentId(
                        transaction,
                    )}: ${Helper.converErrorToString(error)}`,
                );

                this.lockSendingTransactions.delete(keyLock);
                return;
            }
        }

        try {
            // not in transaction db, may error is send succss and here is panic, There is a high probability that it will not appear
            await this.transactionService.updateTransactionStatus(transaction, TRANSACTION_STATUS.PENDING);
        } catch (error) {
            Logger.error(`UpdateTransaction error: ${getDocumentId(transaction)}`, error);
            this.larkService.sendMessage(
                `UpdateTransaction Error On Transaction ${getDocumentId(transaction)}: ${Helper.converErrorToString(error)}`,
            );
        }

        this.lockSendingTransactions.delete(keyLock);
    }

    // There is a concurrency conflict and locks need to be added
    public async handlePendingTransaction(transaction: TransactionDocument, receipt: any) {
        const keyLock = keyLockPendingTransaction(getDocumentId(transaction));
        if (this.lockPendingTransactions.has(keyLock)) {
            return;
        }

        this.lockPendingTransactions.add(keyLock);

        try {
            transaction = await this.transactionService.getTransactionById(getDocumentId(transaction));
            if (!transaction || transaction.isDone()) {
                this.lockPendingTransactions.delete(keyLock);
                return;
            }

            const chainId = transaction.chainId;
            if (!receipt) {
                const userOpHashes = transaction.userOperationHashes;
                await this.userOperationService.setUserOperationsAsDone(userOpHashes, '', 0, '');
                await this.transactionService.updateTransactionStatus(transaction, TRANSACTION_STATUS.DONE);
                const fakeUserOpEvent = { args: ['', '', '', '', false, '', ''], txHash: transaction.txHashes[transaction.txHashes.length - 1] };
                userOpHashes.map((userOpHash) => onEmitUserOpEvent(userOpHash, fakeUserOpEvent));

                this.afterDoneTransaction(transaction);
                this.lockPendingTransactions.delete(keyLock);
                return;
            }

            const results = await this.checkAndHandleFailedReceipt(transaction, receipt);
            for (const { receipt, userOpHashes } of results) {
                this.handleUserOpEvents(chainId, receipt, userOpHashes);

                const txHash = receipt.transactionHash;
                const blockHash = receipt.blockHash;
                const blockNumber = receipt.blockNumber;
                await this.userOperationService.setUserOperationsAsDone(userOpHashes, txHash, blockNumber, blockHash);

                transaction.receipts = transaction.receipts || {};
                transaction.receipts[txHash] = receipt;
                transaction.userOperationHashMapTxHash = transaction.userOperationHashMapTxHash || {};
                for (const userOpHash of userOpHashes) {
                    transaction.userOperationHashMapTxHash[userOpHash] = txHash;
                }
            }

            transaction.markModified('receipts');
            transaction.markModified('userOperationHashMapTxHash');
            await this.transactionService.updateTransactionStatus(transaction, TRANSACTION_STATUS.DONE);
            this.afterDoneTransaction(transaction);
        } catch (error) {
            Logger.error('handlePendingTransaction error', error);

            const errorMessage = Helper.converErrorToString(error);
            this.larkService.sendMessage(
                `HandlePendingTransaction On Chain ${transaction.chainId} For ${getDocumentId(transaction)} Error: ${errorMessage}`,
            );
        }

        this.lockPendingTransactions.delete(keyLock);
    }

    // Check is the userop is bundled by other tx(mev attack)
    // This is not a strict check
    private async checkAndHandleFailedReceipt(
        transaction: TransactionDocument,
        receipt: any,
    ): Promise<{ receipt: any; userOpHashes: string[] }[]> {
        try {
            const bundlerConfig = getBundlerChainConfig(transaction.chainId);

            if (BigInt(receipt.status) === 1n || !bundlerConfig.mevCheck) {
                return [{ receipt, userOpHashes: transaction.userOperationHashes }];
            }

            const provider = this.chainService.getJsonRpcProvider(transaction.chainId);
            const logs = await provider.getLogs({
                fromBlock: BigInt(receipt.blockNumber) - 20n, // if attack by mev bot, it should be includes in latest blocks
                toBlock: BigInt(receipt.blockNumber),
                topics: [EVENT_ENTRY_POINT_USER_OPERATION],
            });

            const txHashes = {};
            for (const log of logs) {
                const userOpHash = log.topics[1];
                if (transaction.userOperationHashes.includes(userOpHash)) {
                    if (!txHashes[log.transactionHash]) {
                        txHashes[log.transactionHash] = [];
                    }

                    txHashes[log.transactionHash].push(userOpHash);
                }
            }

            // if no matched tx, it means this is a normal failed op
            if (Object.keys(txHashes).length === 0) {
                return [{ receipt, userOpHashes: transaction.userOperationHashes }];
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
            Logger.error(`[CheckAndHandleFailedReceipt] Error: ${getDocumentId(transaction)} | ${error?.message}`);
            this.larkService.sendMessage(`CheckAndHandleFailedReceipt Error: ${Helper.converErrorToString(error)}`);
            return [{ receipt, userOpHashes: transaction.userOperationHashes }];
        }
    }

    private async getReceiptAndHandlePendingTransactions(pendingTransaction: TransactionDocument) {
        try {
            // local cache nonce directly
            const signerDoneTransactionMaxNonceFromP2PCache = this.chainService.getTransactionCountWithCache(
                pendingTransaction.chainId,
                pendingTransaction.from,
            );
            const signerDoneTransactionMaxNonceFromLocal = this.signerService.getSignerDoneTransactionMaxNonce(
                pendingTransaction.chainId,
                pendingTransaction.from,
            );

            const signerDoneTransactionMaxNonce = Math.max(signerDoneTransactionMaxNonceFromLocal, signerDoneTransactionMaxNonceFromP2PCache);
            const receiptPromises = pendingTransaction.txHashes.map((txHash) =>
                this.chainService.getTransactionReceipt(pendingTransaction.chainId, txHash),
            );
            const receipts = await Promise.all(receiptPromises);
            for (const receipt of receipts) {
                if (!!receipt) {
                    await this.handlePendingTransaction(pendingTransaction, receipt);
                    return null;
                }
            }

            // the pending transaction is too old, force to finish it
            if (!!signerDoneTransactionMaxNonce && signerDoneTransactionMaxNonce > pendingTransaction.nonce) {
                await this.handlePendingTransaction(pendingTransaction, null);
                return null;
            }

            // force retry
            if (pendingTransaction.incrRetry) {
                await this.tryIncrTransactionGasPriceAndReplace(pendingTransaction);
                return null;
            }

            if (!pendingTransaction.isPendingTimeout() || !signerDoneTransactionMaxNonce) {
                return pendingTransaction;
            }

            const bundlerConfig = getBundlerChainConfig(pendingTransaction.chainId);

            if (
                bundlerConfig.canIncrGasPriceRetry &&
                [signerDoneTransactionMaxNonce + 1, signerDoneTransactionMaxNonce].includes(pendingTransaction.nonce) &&
                pendingTransaction.txHashes.length < bundlerConfig.canIncrGasPriceRetryMaxCount
            ) {
                await this.tryIncrTransactionGasPriceAndReplace(pendingTransaction);
            } else if (pendingTransaction.isOld()) {
                try {
                    // Transactions may be discarded by the node tx pool and need to be reissued
                    await this.chainService.sendRawTransaction(
                        pendingTransaction.chainId,
                        pendingTransaction.signedTxs[pendingTransaction.txHashes[pendingTransaction.txHashes.length - 1]],
                    );
                } catch (error) {
                    if (error?.message?.toLowerCase()?.includes('already known')) {
                        // already send ?? can skip return
                    } else {
                        const tId = getDocumentId(pendingTransaction);
                        const errorMessage = Helper.converErrorToString(error);

                        Logger.error(`trySendOldPendingTransaction Error On Chain ${pendingTransaction.chainId} For ${tId}`, error);
                        this.larkService.sendMessage(
                            `trySendOldPendingTransaction Error On Chain ${pendingTransaction.chainId} For ${tId}: ${errorMessage}`,
                        );
                    }
                }
            }

            return null;
        } catch (error) {
            Logger.error('getReceiptAndHandlePendingTransactions error', error);

            const tId = getDocumentId(pendingTransaction);
            const errorMessage = Helper.converErrorToString(error);
            this.larkService.sendMessage(
                `getReceiptAndHandlePendingTransactions Error On Chain ${pendingTransaction.chainId} For ${tId}: ${errorMessage}`,
            );
        }
    }

    private async tryIncrTransactionGasPriceAndReplace(transaction: TransactionDocument) {
        const keyLock = keyLockPendingTransaction(getDocumentId(transaction));
        if (this.lockPendingTransactions.has(keyLock)) {
            return;
        }

        this.lockPendingTransactions.add(keyLock);

        transaction = await this.transactionService.getTransactionById(getDocumentId(transaction));
        if (transaction.isDone()) {
            this.lockPendingTransactions.delete(keyLock);
            return;
        }

        try {
            const remoteNonce = await this.chainService.getTransactionCountIfCache(transaction.chainId, transaction.from, true);
            if (remoteNonce != transaction.nonce) {
                this.lockPendingTransactions.delete(keyLock);
                return;
            }
        } catch (error) {
            this.larkService.sendMessage(
                `TryIncrTransactionGasPrice GetTransactionCount Error On Chain ${transaction.chainId} For ${
                    transaction.from
                }: ${Helper.converErrorToString(error)}`,
            );

            this.lockPendingTransactions.delete(keyLock);
            return;
        }

        if (!transaction.isPendingTimeout()) {
            this.lockPendingTransactions.delete(keyLock);
            return;
        }

        const allValidSigners = this.signerService.getRandomValidSigners(transaction.chainId);
        const signer = allValidSigners.find((signer) => signer.address.toLowerCase() === transaction.from.toLowerCase());
        if (!signer) {
            this.lockPendingTransactions.delete(keyLock);
            return;
        }

        try {
            const coefficient = 1.1;

            const currentSignedTx = transaction.signedTxs[transaction.txHashes[transaction.txHashes.length - 1]];
            const tx = tryParseSignedTx(currentSignedTx);
            const txData: any = tx.toJSON();

            const feeData = await this.chainService.getFeeDataIfCache(transaction.chainId);
            if (tx instanceof FeeMarketEIP1559Transaction) {
                if (BigInt(feeData.maxFeePerGas) > BigInt(tx.maxFeePerGas)) {
                    txData.maxFeePerGas = toBeHex(feeData.maxFeePerGas);
                }
                if (BigInt(feeData.maxPriorityFeePerGas) > BigInt(tx.maxPriorityFeePerGas)) {
                    txData.maxPriorityFeePerGas = toBeHex(feeData.maxPriorityFeePerGas);
                }

                let bnMaxPriorityFeePerGas = BigInt(txData.maxPriorityFeePerGas);
                let bnMaxFeePerGas = BigInt(txData.maxFeePerGas);
                if (bnMaxPriorityFeePerGas === 0n) {
                    bnMaxPriorityFeePerGas = BigInt(0.01 * 10 ** 9);
                    if (bnMaxPriorityFeePerGas >= bnMaxFeePerGas) {
                        bnMaxFeePerGas = bnMaxPriorityFeePerGas + 1n;
                    }
                }

                txData.maxPriorityFeePerGas = toBeHex((bnMaxPriorityFeePerGas * BigInt(coefficient * 10)) / 10n);
                txData.maxFeePerGas = toBeHex((bnMaxFeePerGas * BigInt(coefficient * 10)) / 10n);
            }

            if (tx instanceof LegacyTransaction) {
                if (BigInt(feeData.gasPrice) > BigInt(tx.gasPrice)) {
                    txData.gasPrice = toBeHex(feeData.gasPrice);
                }

                txData.gasPrice = (BigInt(tx.gasPrice) * BigInt(coefficient * 10)) / 10n;
            }

            const signedTx = await signer.signTransaction({
                chainId: transaction.chainId,
                to: txData.to,
                data: txData.data,
                nonce: txData.nonce,
                gasLimit: txData.gasLimit,
                ...createTxGasData(transaction.chainId, txData),
            });

            // if failed and it's ok, just generate a invalid tx hash
            await this.transactionService.replaceTransactionTxHash(transaction, signedTx);
            await this.chainService.sendRawTransaction(transaction.chainId, signedTx);
        } catch (error) {
            if (error?.message?.toLowerCase()?.includes('already known')) {
                // already send ?? can skip return
            } else {
                Logger.error(`Replace Transaction ${transaction._id.toString()} error on chain ${transaction.chainId}`);
                this.larkService.sendMessage(
                    `ReplaceTransaction Error On Chain ${transaction.chainId} For ${transaction.from}: ${Helper.converErrorToString(error)}`,
                );
            }
        }

        this.lockPendingTransactions.delete(keyLock);
    }

    private handleUserOpEvents(chainId: number, receipt: any, userOpHashes: string[]) {
        const userOperationEventObjects: IUserOperationEventObject[] = [];
        const txHash = receipt.transactionHash;
        const blockHash = receipt.blockHash;
        const blockNumber = receipt.blockNumber;

        const contract = new Contract(receipt.to, entryPointAbi);
        for (const log of receipt?.logs ?? []) {
            try {
                const parsed = contract.interface.parseLog(log);
                if (parsed?.name !== 'UserOperationEvent') {
                    continue;
                }

                const args = deepHexlify(parsed.args);
                userOperationEventObjects.push({
                    chainId,
                    blockHash,
                    blockNumber,
                    userOperationHash: parsed.args.userOpHash,
                    txHash: receipt.transactionHash,
                    contractAddress: receipt.to,
                    topic: parsed.topic,
                    args,
                });
            } catch (error) {
                // May not be an EntryPoint event.
                continue;
            }
        }

        // async send
        if (BigInt(receipt.status) === 1n) {
            this.userOperationService.createUserOperationEvents(userOperationEventObjects);
            userOperationEventObjects.map((o) => onEmitUserOpEvent(o.userOperationHash, o));
        } else {
            const fakeUserOpEvent = { args: ['', '', '', '', false, '', ''], txHash };
            userOpHashes.map((userOpHash: string) => onEmitUserOpEvent(userOpHash, fakeUserOpEvent));
        }
    }

    private afterDoneTransaction(transaction: TransactionDocument) {
        this.signerService.decrChainSignerPendingTxCount(transaction.chainId, transaction.from);
        this.signerService.setSignerDoneTransactionMaxNonce(transaction.chainId, transaction.from, transaction.nonce);
    }
}
