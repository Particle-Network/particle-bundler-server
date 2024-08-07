import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import {
    BLOCK_SIGNER_REASON,
    EVENT_ENTRY_POINT_USER_OPERATION,
    keyLockPendingTransaction,
    keyLockSendingTransaction,
} from '../../common/common-types';
import { TransactionService } from '../rpc/services/transaction.service';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { getBundlerChainConfig, onEmitUserOpEvent } from '../../configs/bundler-common';
import { Wallet, toBeHex } from 'ethers';
import { canRunCron, createTxGasData, deepHexlify, tryParseSignedTx } from '../rpc/aa/utils';
import { Cron } from '@nestjs/schedule';
import { FeeMarketEIP1559Transaction, LegacyTransaction } from '@ethereumjs/tx';
import { SignerService } from '../rpc/services/signer.service';
import { ChainService } from '../rpc/services/chain.service';
import { NEED_TO_ESTIMATE_GAS_BEFORE_SEND } from '../../common/chains';
import { RpcService } from '../rpc/services/rpc.service';
import { entryPointAbis } from '../rpc/aa/abis/entry-point-abis';
import { TRANSACTION_STATUS, TransactionEntity } from '../rpc/entities/transaction.entity';
import { UserOperationEventEntity } from '../rpc/entities/user-operation-event.entity';

@Injectable()
export class HandlePendingTransactionService {
    private readonly lockSendingTransactions: Set<string> = new Set();
    private readonly lockPendingTransactions: Set<string> = new Set();

    public constructor(
        @InjectConnection() private readonly connection: Connection,
        private readonly rpcService: RpcService,
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

    private async handlePendingTransactionsAction(pendingTransactions: TransactionEntity[]) {
        const promises = [];
        for (const pendingTransaction of pendingTransactions) {
            promises.push(this.getReceiptAndHandlePendingTransactions(pendingTransaction));
        }

        const transactionEntitiesAddConfirmations: TransactionEntity[] = (await Promise.all(promises)).filter((t) => !!t);
        this.transactionService.addTransactionsConfirmations(transactionEntitiesAddConfirmations.map((t) => t.id));
    }

    // There is a concurrency conflict and locks need to be added
    public async trySendAndUpdateTransactionStatus(transactionEntity: TransactionEntity, txHash: string) {
        if (!transactionEntity.signedTxs[txHash]) {
            return;
        }

        if (this.signerService.isBlockedSigner(transactionEntity.chainId, transactionEntity.from)) {
            return;
        }

        const keyLock = keyLockSendingTransaction(transactionEntity.id);
        if (this.lockSendingTransactions.has(keyLock)) {
            return;
        }

        this.lockSendingTransactions.add(keyLock);

        try {
            // It's possible that when you grab the lock, the previous call has already been made, so you need to check it again
            transactionEntity = await this.transactionService.getTransactionById(transactionEntity.id);
            if (!transactionEntity || transactionEntity.status !== TRANSACTION_STATUS.LOCAL) {
                this.lockSendingTransactions.delete(keyLock);
                return;
            }

            const start = Date.now();
            Logger.debug(`[SendRawTransaction] Start | Chain ${transactionEntity.chainId} | ${transactionEntity.id}`);

            await this.chainService.sendRawTransaction(transactionEntity.chainId, transactionEntity.signedTxs[txHash]);

            Logger.debug(
                `[SendRawTransaction] End | Chain ${transactionEntity.chainId} | ${transactionEntity.id} | Cost ${
                    Date.now() - start
                } ms`,
            );
        } catch (error) {
            if (error?.message?.toLowerCase()?.includes('already known')) {
                // already send ?? can skip
            } else {
                // insufficient funds for intrinsic transaction cost
                if (error?.message?.toLowerCase()?.includes('insufficient funds')) {
                    this.signerService.setBlockedSigner(
                        transactionEntity.chainId,
                        transactionEntity.from,
                        BLOCK_SIGNER_REASON.INSUFFICIENT_BALANCE,
                        {
                            transactionId: transactionEntity.id,
                        },
                    );
                } else if (
                    error?.message?.toLowerCase()?.includes('nonce too low') ||
                    error?.message?.toLowerCase()?.includes('replacement transaction underpriced')
                ) {
                    // delete transaction and recover user op
                    this.chainService.trySetTransactionCountLocalCache(
                        transactionEntity.chainId,
                        transactionEntity.from,
                        transactionEntity.nonce + 1,
                    );
                    await this.transactionService.deleteTransactionAndResetUserOperations(transactionEntity.id);
                } else if (
                    error?.message?.toLowerCase()?.includes('reverted transaction') ||
                    error?.message?.toLowerCase()?.includes('intrinsic gas too low')
                ) {
                    // send a empty traction to custom the nonce (for after nonce can send correctly).
                    const signers = this.signerService.getChainSigners(transactionEntity.chainId);
                    const signer = signers.find((x) => x.address === transactionEntity.from);

                    const signedTx = await this.signEmptyTxWithNonce(transactionEntity.chainId, signer, transactionEntity.nonce);
                    await this.transactionService.replaceTransactionTxHash(transactionEntity, signedTx, TRANSACTION_STATUS.LOCAL);
                }

                Logger.error(`SendTransaction error: ${transactionEntity.id}`, error);
                this.larkService.sendMessage(
                    `Send Transaction Error On Chain ${transactionEntity.chainId} And Transaction ${transactionEntity.id}: ${Helper.converErrorToString(error)}`,
                );

                this.lockSendingTransactions.delete(keyLock);
                return;
            }
        }

        try {
            // not in transaction db, may error is send succss and here is panic, There is a high probability that it will not appear
            let start = Date.now();
            await this.transactionService.updateTransaction(transactionEntity, { status: TRANSACTION_STATUS.PENDING });
            Logger.debug(`[UpdateTransactionAsPending] ${transactionEntity.id}, Cost: ${Date.now() - start} ms`);
        } catch (error) {
            Logger.error(`UpdateTransaction error: ${transactionEntity.id}`, error);
            this.larkService.sendMessage(
                `UpdateTransaction Error On Transaction ${transactionEntity.id}: ${Helper.converErrorToString(error)}`,
            );
        }

        this.lockSendingTransactions.delete(keyLock);
    }

    // There is a concurrency conflict and locks need to be added
    public async handlePendingTransaction(transactionEntity: TransactionEntity, receipt: any) {
        const keyLock = keyLockPendingTransaction(transactionEntity.id);
        if (this.lockPendingTransactions.has(keyLock)) {
            return;
        }

        this.lockPendingTransactions.add(keyLock);

        try {
            transactionEntity = await this.transactionService.getTransactionById(transactionEntity.id);
            if (!transactionEntity || transactionEntity.status === TRANSACTION_STATUS.DONE) {
                this.lockPendingTransactions.delete(keyLock);
                return;
            }

            const chainId = transactionEntity.chainId;
            if (!receipt) {
                const userOpHashes = transactionEntity.userOperationHashes;
                await this.userOperationService.setUserOperationsAsDone(userOpHashes, '', 0, '');
                await this.transactionService.updateTransaction(transactionEntity, { status: TRANSACTION_STATUS.DONE });

                const txHash = transactionEntity.txHashes[transactionEntity.txHashes.length - 1];
                const fakeUserOpEvent = { args: ['', '', '', '', false, '', ''], txHash };
                userOpHashes.map((userOpHash: string) => onEmitUserOpEvent(userOpHash, fakeUserOpEvent));

                this.afterDoneTransaction(transactionEntity);
                this.lockPendingTransactions.delete(keyLock);
                return;
            }

            const results = await this.checkAndHandleFailedReceipt(transactionEntity, receipt);
            for (const { receipt, userOpHashes } of results) {
                this.handleUserOpEvents(chainId, receipt, userOpHashes);

                const txHash = receipt.transactionHash;
                const blockHash = receipt.blockHash;
                const blockNumber = receipt.blockNumber;
                await this.userOperationService.setUserOperationsAsDone(userOpHashes, txHash, blockNumber, blockHash);

                transactionEntity.receipts = transactionEntity.receipts || {};
                transactionEntity.receipts[txHash] = receipt;
                transactionEntity.userOperationHashMapTxHash = transactionEntity.userOperationHashMapTxHash || {};
                for (const userOpHash of userOpHashes) {
                    transactionEntity.userOperationHashMapTxHash[userOpHash] = txHash;
                }
            }

            await this.transactionService.updateTransaction(transactionEntity, {
                status: TRANSACTION_STATUS.DONE,
                receipts: transactionEntity.receipts,
                userOperationHashMapTxHash: transactionEntity.userOperationHashMapTxHash,
            });

            this.afterDoneTransaction(transactionEntity);
        } catch (error) {
            Logger.error('handlePendingTransaction error', error);

            const errorMessage = Helper.converErrorToString(error);
            this.larkService.sendMessage(
                `HandlePendingTransaction On Chain ${transactionEntity.chainId} For ${transactionEntity.id} Error: ${errorMessage}`,
            );
        }

        this.lockPendingTransactions.delete(keyLock);
    }

    // Check is the userop is bundled by other tx(mev attack)
    // This is not a strict check
    private async checkAndHandleFailedReceipt(
        transactionEntity: TransactionEntity,
        receipt: any,
    ): Promise<{ receipt: any; userOpHashes: string[] }[]> {
        try {
            const bundlerConfig = getBundlerChainConfig(transactionEntity.chainId);

            if (BigInt(receipt.status) === 1n || !bundlerConfig.mevCheck) {
                return [{ receipt, userOpHashes: transactionEntity.userOperationHashes }];
            }

            const provider = this.chainService.getJsonRpcProvider(transactionEntity.chainId);
            const logs = await provider.getLogs({
                fromBlock: BigInt(receipt.blockNumber) - 20n, // if attack by mev bot, it should be includes in latest blocks
                toBlock: BigInt(receipt.blockNumber),
                topics: [EVENT_ENTRY_POINT_USER_OPERATION],
            });

            const txHashes = {};
            for (const log of logs) {
                const userOpHash = log.topics[1];
                if (transactionEntity.userOperationHashes.includes(userOpHash)) {
                    if (!txHashes[log.transactionHash]) {
                        txHashes[log.transactionHash] = [];
                    }

                    txHashes[log.transactionHash].push(userOpHash);
                }
            }

            // if no matched tx, it means this is a normal failed op
            if (Object.keys(txHashes).length === 0) {
                return [{ receipt, userOpHashes: transactionEntity.userOperationHashes }];
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
            Logger.error(`[CheckAndHandleFailedReceipt] Error: ${transactionEntity.id} | ${error?.message}`);
            this.larkService.sendMessage(`CheckAndHandleFailedReceipt Error: ${Helper.converErrorToString(error)}`);
            return [{ receipt, userOpHashes: transactionEntity.userOperationHashes }];
        }
    }

    private async getReceiptAndHandlePendingTransactions(pendingTransactionEntity: TransactionEntity) {
        try {
            // local cache nonce directly
            const signerDoneTransactionMaxNonceFromP2PCache = this.chainService.getTransactionCountWithCache(
                pendingTransactionEntity.chainId,
                pendingTransactionEntity.from,
            );
            const signerDoneTransactionMaxNonceFromLocal = this.signerService.getSignerDoneTransactionMaxNonce(
                pendingTransactionEntity.chainId,
                pendingTransactionEntity.from,
            );

            const signerDoneTransactionMaxNonce = Math.max(signerDoneTransactionMaxNonceFromLocal, signerDoneTransactionMaxNonceFromP2PCache);

            const start = Date.now();
            const receiptPromises = pendingTransactionEntity.txHashes.map((txHash) =>
                this.chainService.getTransactionReceipt(pendingTransactionEntity.chainId, txHash),
            );
            const receipts = await Promise.all(receiptPromises);
            Logger.debug(
                `[GetAllTransactionReceipt] ${pendingTransactionEntity.chainId} | ${pendingTransactionEntity.id}, Cost ${
                    Date.now() - start
                } ms`,
            );

            for (const receipt of receipts) {
                if (!!receipt) {
                    await this.handlePendingTransaction(pendingTransactionEntity, receipt);
                    return null;
                }
            }

            // the pending transaction is too old, force to finish it
            if (!!signerDoneTransactionMaxNonce && signerDoneTransactionMaxNonce > pendingTransactionEntity.nonce) {
                await this.handlePendingTransaction(pendingTransactionEntity, null);
                return null;
            }

            // force retry
            if (pendingTransactionEntity.incrRetry) {
                await this.tryIncrTransactionGasPriceAndReplace(pendingTransactionEntity, 1.5);
                return null;
            }

            if (!pendingTransactionEntity.isPendingTimeout() || !signerDoneTransactionMaxNonce) {
                return pendingTransactionEntity;
            }

            const bundlerConfig = getBundlerChainConfig(pendingTransactionEntity.chainId);

            if (
                bundlerConfig.canIncrGasPriceRetry &&
                [signerDoneTransactionMaxNonce + 1, signerDoneTransactionMaxNonce].includes(pendingTransactionEntity.nonce) &&
                pendingTransactionEntity.txHashes.length < bundlerConfig.canIncrGasPriceRetryMaxCount
            ) {
                await this.tryIncrTransactionGasPriceAndReplace(pendingTransactionEntity);
            } else if (pendingTransactionEntity.isOld() && !pendingTransactionEntity.isTooOld()) {
                try {
                    // Transactions may be discarded by the node tx pool and need to be reissued
                    await this.chainService.sendRawTransaction(
                        pendingTransactionEntity.chainId,
                        pendingTransactionEntity.signedTxs[pendingTransactionEntity.txHashes[pendingTransactionEntity.txHashes.length - 1]],
                    );
                } catch (error) {
                    if (
                        error?.message?.toLowerCase()?.includes('already known') ||
                        error?.message?.toLowerCase()?.includes('known transaction')
                    ) {
                        // already send ?? can skip return
                    } else {
                        const tId = pendingTransactionEntity.id;
                        const errorMessage = Helper.converErrorToString(error);

                        Logger.error(`trySendOldPendingTransaction Error On Chain ${pendingTransactionEntity.chainId} For ${tId}`, error);
                        this.larkService.sendMessage(
                            `trySendOldPendingTransaction Error On Chain ${pendingTransactionEntity.chainId} For ${tId}: ${errorMessage}`,
                        );
                    }
                }
            }

            return null;
        } catch (error) {
            Logger.error('getReceiptAndHandlePendingTransactions error', error);

            const errorMessage = Helper.converErrorToString(error);
            this.larkService.sendMessage(
                `getReceiptAndHandlePendingTransactions Error On Chain ${pendingTransactionEntity.chainId} For ${pendingTransactionEntity.id}: ${errorMessage}`,
            );
        }
    }

    private async tryIncrTransactionGasPriceAndReplace(transactionEntity: TransactionEntity, coefficient = 1.1) {
        const keyLock = keyLockPendingTransaction(transactionEntity.id);
        if (this.lockPendingTransactions.has(keyLock)) {
            return;
        }

        this.lockPendingTransactions.add(keyLock);

        transactionEntity = await this.transactionService.getTransactionById(transactionEntity.id);
        if (transactionEntity.status === TRANSACTION_STATUS.DONE) {
            this.lockPendingTransactions.delete(keyLock);
            return;
        }

        try {
            const remoteNonce = await this.chainService.getTransactionCountIfCache(transactionEntity.chainId, transactionEntity.from, true);
            if (remoteNonce != transactionEntity.nonce) {
                this.lockPendingTransactions.delete(keyLock);
                return;
            }
        } catch (error) {
            this.larkService.sendMessage(
                `TryIncrTransactionGasPrice GetTransactionCount Error On Chain ${transactionEntity.chainId} For ${
                    transactionEntity.from
                }: ${Helper.converErrorToString(error)}`,
            );

            this.lockPendingTransactions.delete(keyLock);
            return;
        }

        if (!transactionEntity.isPendingTimeout()) {
            this.lockPendingTransactions.delete(keyLock);
            return;
        }

        const allValidSigners = this.signerService.getRandomValidSigners(transactionEntity.chainId);
        const signer = allValidSigners.find((signer) => signer.address.toLowerCase() === transactionEntity.from.toLowerCase());
        if (!signer) {
            this.lockPendingTransactions.delete(keyLock);
            return;
        }

        try {
            const currentSignedTx = transactionEntity.signedTxs[transactionEntity.txHashes[transactionEntity.txHashes.length - 1]];
            const tx = tryParseSignedTx(currentSignedTx);
            const txData: any = tx.toJSON();

            const feeData = await this.chainService.getFeeDataIfCache(transactionEntity.chainId);
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
                chainId: transactionEntity.chainId,
                to: txData.to,
                data: txData.data,
                nonce: txData.nonce,
                gasLimit: txData.gasLimit,
                ...createTxGasData(transactionEntity.chainId, txData),
            });

            // if failed and it's ok, just generate a invalid tx hash
            await this.transactionService.replaceTransactionTxHash(transactionEntity, signedTx, TRANSACTION_STATUS.PENDING);
            await this.chainService.sendRawTransaction(transactionEntity.chainId, signedTx);
        } catch (error) {
            if (error?.message?.toLowerCase()?.includes('already known')) {
                // already send ?? can skip return
            } else {
                Logger.error(`Replace Transaction ${transactionEntity.id} error on chain ${transactionEntity.chainId}`);
                this.larkService.sendMessage(
                    `ReplaceTransaction Error On Chain ${transactionEntity.chainId} For ${transactionEntity.from}: ${Helper.converErrorToString(
                        error,
                    )}`,
                );
            }
        }

        this.lockPendingTransactions.delete(keyLock);
    }

    private handleUserOpEvents(chainId: number, receipt: any, userOpHashes: string[]) {
        const userOperationEventEntities: UserOperationEventEntity[] = [];
        const txHash = receipt.transactionHash;
        const blockHash = receipt.blockHash;
        const blockNumber = receipt.blockNumber;

        const entryPointVersion = this.rpcService.getVersionByEntryPoint(receipt.to);
        const contract = this.rpcService.getSetCachedContract(receipt.to, entryPointAbis[entryPointVersion]);
        for (const log of receipt?.logs ?? []) {
            try {
                const parsed = contract.interface.parseLog(log);
                if (parsed?.name !== 'UserOperationEvent') {
                    continue;
                }

                const args = deepHexlify(parsed.args);
                userOperationEventEntities.push(
                    new UserOperationEventEntity({
                        chainId,
                        blockHash,
                        blockNumber: Number(BigInt(blockNumber)),
                        userOpHash: parsed.args.userOpHash,
                        txHash: receipt.transactionHash,
                        entryPoint: receipt.to,
                        topic: parsed.topic,
                        args,
                    }),
                );
            } catch (error) {
                // May not be an EntryPoint event.
                continue;
            }
        }

        // async send
        if (BigInt(receipt.status) === 1n) {
            this.userOperationService.createUserOperationEvents(userOperationEventEntities);
            userOperationEventEntities.map((o) => onEmitUserOpEvent(o.userOpHash, o));
        } else {
            const fakeUserOpEvent = { args: ['', '', '', '', false, '', ''], txHash };
            userOpHashes.map((userOpHash: string) => onEmitUserOpEvent(userOpHash, fakeUserOpEvent));
        }
    }

    private afterDoneTransaction(transactionEntity: TransactionEntity) {
        const txHash = transactionEntity.txHashes[transactionEntity.txHashes.length - 1];
        Logger.debug(`[updateTransactionStatus] Done | TransactionId: ${transactionEntity.id} | TxHash: ${txHash}`);

        this.signerService.decrChainSignerPendingTxCount(transactionEntity.chainId, transactionEntity.from);
        this.signerService.setSignerDoneTransactionMaxNonce(transactionEntity.chainId, transactionEntity.from, transactionEntity.nonce);
    }

    private async signEmptyTxWithNonce(chainId: number, signer: Wallet, nonce: number): Promise<string> {
        const feeData = await this.chainService.getFeeDataIfCache(chainId);
        let gasLimit = 21000;
        if (NEED_TO_ESTIMATE_GAS_BEFORE_SEND.includes(chainId)) {
            gasLimit = 210000;
        }

        return await signer.signTransaction({
            chainId,
            to: signer.address,
            value: toBeHex(0),
            data: '0x',
            nonce,
            gasLimit,
            ...createTxGasData(chainId, feeData),
        });
    }
}
