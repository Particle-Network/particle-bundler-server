import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AAService } from '../rpc/services/aa.service';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { RpcService } from '../rpc/services/rpc.service';
import { TransactionService } from '../rpc/services/transaction.service';
import {
    BLOCK_SIGNER_REASON,
    BUNDLING_MODE,
    IS_DEVELOPMENT,
    PENDING_TRANSACTION_SIGNER_HANDLE_LIMIT,
    REDIS_TASK_CONNECTION_NAME,
    keyEventSendUserOperation,
    keyLockChainId,
    keyLockSigner,
} from '../../common/common-types';
import { TRANSACTION_STATUS, TransactionDocument } from '../rpc/schemas/transaction.schema';
import { Helper } from '../../common/helper';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { handlePendingTransaction, tryIncrTransactionGasPrice } from '../rpc/shared/handle-pending-transactions';
import { handleLocalUserOperations } from '../rpc/shared/handle-local-user-operations';
import { Cron } from '@nestjs/schedule';
import Lock from '../../common/global-lock';
import { handleLocalTransaction } from '../rpc/shared/handle-local-transactions';
import { RPC_CONFIG } from '../../configs/bundler-common';
import { Contract, Wallet, parseEther } from 'ethers';
import verifyingPaymasterAbi from '../rpc/aa/verifying-paymaster-abi';
import { BigNumber } from '../../common/bignumber';
import { Alert } from '../../common/alert';
import { isObject } from 'lodash';
import {
    CHAIN_BALANCE_RANGE,
    CHAIN_SIGNER_MIN_BALANCE,
    CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT,
} from '../../configs/bundler-config';
import { getFeeDataFromParticle } from '../rpc/aa/utils';

const FETCH_TRANSACTION_SIZE = 500;

/**
 * Please Ensure that the task service is only running on one instance
 * To make sure the user operations are sealed and executed in order.
 *
 * TODO: add redis lock to make sure only one instance is running
 */
@Injectable()
export class TaskService {
    public constructor(
        private readonly configService: ConfigService,
        private readonly rpcService: RpcService,
        private readonly aaService: AAService,
        private readonly transactionService: TransactionService,
        private readonly userOperationService: UserOperationService,
        @InjectRedis(REDIS_TASK_CONNECTION_NAME) private readonly redis: Redis,
        @InjectConnection() private readonly connection: Connection,
    ) {
        this.initialize();
    }

    private canRun: boolean = true;
    private latestSealUserOpsAtByChainId: Map<number, number> = new Map();
    private sealUserOpsFlag: Map<number, boolean> = new Map();
    private inCheckingPaymasterBalance: boolean = false;
    private inCheckingSignerBalance: boolean = false;
    private inCheckingAndReleaseBlockSigners: boolean = false;

    private initialize() {
        if (!this.canRunCron()) {
            return;
        }

        this.redis.subscribe(keyEventSendUserOperation);
        this.redis.on('message', (channel, message) => {
            if (channel !== keyEventSendUserOperation) {
                return;
            }

            try {
                const data = JSON.parse(message);
                this.sealUserOpsByDuration(data?.chainId);
            } catch (error) {
                // nothing
            }
        });

        const bundlingMode = this.aaService.getBundlingMode();
        if (bundlingMode === BUNDLING_MODE.AUTO) {
            Object.values(RPC_CONFIG).forEach((rpcConfig: any) => {
                this.sealUserOpsByDuration(rpcConfig.chainId);
            });
        }
    }

    @Cron('* * * * * *')
    public async sealUserOps() {
        for (const chainId in RPC_CONFIG) {
            if (this.sealUserOpsFlag.get(Number(chainId))) {
                Logger.log('sealUserOps', chainId);
                this.sealUserOpsByDuration(Number(chainId));
            }
        }
    }

    private async sealUserOpsByDuration(chainId: number) {
        this.sealUserOpsFlag.set(chainId, true);

        const targetSigner: Wallet = await this.waitForASigner(chainId);
        if (!targetSigner) {
            Logger.warn(`No signer available on ${chainId}`);
            return;
        }

        await Lock.acquire(keyLockChainId(chainId));

        Logger.log(`sealUserOpsByDuration acquire ${targetSigner.address} on chain ${chainId}`);
        if (!this.sealUserOpsFlag.get(chainId)) {
            Logger.log(`sealUserOpsByDuration release ${targetSigner.address} on chain ${chainId}`);

            Lock.release(keyLockSigner(chainId, targetSigner.address));
            Lock.release(keyLockChainId(chainId));
            return;
        }

        this.sealUserOpsFlag.set(chainId, false);

        const endAt = Date.now();
        const startAt = this.latestSealUserOpsAtByChainId.get(chainId) || 0;
        this.latestSealUserOpsAtByChainId.set(chainId, endAt);

        Lock.release(keyLockChainId(chainId));

        this.getAndHandleLocalUserOperationsByDuration(chainId, targetSigner, startAt, endAt);
    }

    private async getAndHandleLocalUserOperationsByDuration(chainId: number, targetSigner: Wallet, startAt: number, endAt: number) {
        const userOperations = await this.userOperationService.getLocalUserOperationsByDuration(chainId, startAt, endAt);
        Logger.log(`[sealUserOpsByDuration] chainId=${chainId}, startAt=${startAt}, endAt=${endAt}, userOpLength: ${userOperations.length}`);

        if (userOperations.length <= 0) {
            Lock.release(keyLockSigner(chainId, targetSigner.address));
            return;
        }

        handleLocalUserOperations(chainId, this.rpcService, this.aaService, targetSigner, userOperations, this.connection);
    }

    private async waitForASigner(chainId: number): Promise<Wallet> {
        let targetSigner: Wallet;
        const randomSigners = this.aaService.getRandomSigners(chainId);
        for (let index = 0; index < randomSigners.length; index++) {
            const signer = randomSigners[index];
            if (!Lock.isAcquired(keyLockSigner(chainId, signer.address))) {
                await Lock.acquire(keyLockSigner(chainId, signer.address));
                targetSigner = signer;
                break;
            }
        }

        if (targetSigner) {
            const targetSignerPendingTxCount = await this.transactionService.getPendingTransactionCountBySigner(chainId, targetSigner.address);
            if (targetSignerPendingTxCount >= PENDING_TRANSACTION_SIGNER_HANDLE_LIMIT) {
                targetSigner = null;
                Lock.release(keyLockSigner(chainId, targetSigner.address));
            }
        }

        return targetSigner;
    }

    @Cron('* * * * * *')
    public async handleLocalTransactions() {
        const keyLock = 'keylock-task-handleLocalTransactions';
        if (!this.canRunCron() || Lock.isAcquired(keyLock)) {
            return;
        }

        await Lock.acquire(keyLock);

        try {
            const localTransactions = await this.transactionService.getTransactionsByStatus(TRANSACTION_STATUS.LOCAL, FETCH_TRANSACTION_SIZE);

            const promises = [];
            for (const localTransaction of localTransactions) {
                const provider = this.rpcService.getJsonRpcProvider(localTransaction.chainId);
                promises.push(handleLocalTransaction(this.connection, localTransaction, provider, this.rpcService, this.aaService));
            }

            await Promise.all(promises);
        } catch (error) {
            Logger.error(error);
            Alert.sendMessage(`Handle Local Transactions Error: ${Helper.converErrorToString(error)}`);
        }

        Lock.release(keyLock);
    }

    @Cron('* * * * * *')
    public handlePendingTransactions() {
        if (!this.canRunCron()) {
            return;
        }

        // async execute, no need to wait
        this.handlePendingTransactionsAction();
    }

    private async handlePendingTransactionsAction() {
        const pendingTransactions = await this.transactionService.getTransactionsByStatus(TRANSACTION_STATUS.PENDING, FETCH_TRANSACTION_SIZE);
        for (const pendingTransaction of pendingTransactions) {
            this.getReceiptAndHandlePendingTransactions(pendingTransaction);
        }
    }

    private async getReceiptAndHandlePendingTransactions(pendingTransaction: TransactionDocument) {
        try {
            const provider = this.rpcService.getJsonRpcProvider(pendingTransaction.chainId);
            const receiptPromises = pendingTransaction.txHashes.map((txHash) => this.rpcService.getTransactionReceipt(provider, txHash));
            const receipts = await Promise.all(receiptPromises);

            Logger.log('getReceiptAndHandlePendingTransactions', receipts.length);
            if (receipts.some((r) => !!r)) {
                Logger.log(
                    'receipts',
                    receipts.map((r: any, index: number) => {
                        return {
                            result: !!r,
                            txHash: pendingTransaction.txHashes[index],
                            chainId: pendingTransaction.chainId,
                            from: pendingTransaction.from,
                            nonce: pendingTransaction.nonce,
                        };
                    }),
                );
            }

            for (const receipt of receipts) {
                if (!!receipt) {
                    await handlePendingTransaction(provider, receipt, this.connection, pendingTransaction, this.aaService);
                    return;
                }
            }

            if (!pendingTransaction.isPendingTimeout()) {
                return;
            }

            await tryIncrTransactionGasPrice(pendingTransaction, this.connection, provider, this.aaService);
        } catch (error) {
            Logger.error('getReceiptAndHandlePendingTransactions error', error);

            Alert.sendMessage(`getReceiptAndHandlePendingTransactions Error: ${Helper.converErrorToString(error)}`);
        }
    }

    private canRunCron() {
        if (IS_DEVELOPMENT) {
            return true;
        }

        return this.canRun && this.configService.get('NODE_APP_INSTANCE') === '0';
    }

    @Cron('0 * * * * *')
    public async checkAndFillSignerBalance() {
        if (!this.canRunCron() || this.inCheckingSignerBalance || !isObject(CHAIN_SIGNER_MIN_BALANCE) || !process.env.PAYMENT_SIGNER) {
            return;
        }

        this.inCheckingSignerBalance = true;

        let currentChainId: any;
        let currentAddress: any;

        for (const chainId in CHAIN_SIGNER_MIN_BALANCE) {
            try {
                currentChainId = chainId;
                const provider = this.rpcService.getJsonRpcProvider(Number(chainId));

                const minEtherBalance = CHAIN_SIGNER_MIN_BALANCE[chainId];
                const signers = this.aaService.getSigners();
                for (const signer of signers) {
                    const address = signer.address;
                    currentAddress = address;

                    const balance = await provider.getBalance(address);
                    const balanceEther = BigNumber.from(balance).div(1e9).toNumber() / 1e9;
                    Logger.log(`[Check signer balance] chainId=${chainId}, address=${address}, balance=${balanceEther}`);

                    if (balanceEther < minEtherBalance) {
                        const etherToSend = (minEtherBalance - balanceEther).toFixed(10);
                        Logger.log(`[Send ether to signer] chainId=${chainId}, address=${address}, etherToSend=${etherToSend}`);
                        const signerToPay = new Wallet(process.env.PAYMENT_SIGNER, provider);
                        const feeData: any = await getFeeDataFromParticle(Number(chainId));

                        // force use gas price
                        const tx = await signerToPay.sendTransaction({
                            type: 0,
                            to: address,
                            value: parseEther(etherToSend.toString()) + parseEther(String(CHAIN_BALANCE_RANGE[chainId.toString()] ?? '0.1')),
                            gasPrice: feeData.gasPrice,
                        });

                        Logger.log(`[Sent Tx] ${chainId}, ${tx.hash}`);
                        await tx.wait();
                        const balanceAfter = await provider.getBalance(address);
                        const balanceEtherAfter = BigNumber.from(balanceAfter).div(1e9).toNumber() / 1e9;
                        Logger.log('After send', chainId, address, balanceEtherAfter);

                        this.aaService.UnblockedSigner(Number(chainId), address);

                        Alert.sendMessage(
                            `Fill Signer For ${currentAddress} On ChainId ${currentChainId}, Current Balance: ${balanceAfter}`,
                            `Fill Signer Success`,
                        );
                    }
                }
            } catch (error) {
                Logger.error(error);

                Alert.sendMessage(
                    `Fill Signer Failed For ${currentAddress} On ChainId ${currentChainId}\n${Helper.converErrorToString(error)}`,
                    `Fill Signer Error`,
                );
            }
        }

        this.inCheckingSignerBalance = false;
    }

    @Cron('30 * * * * *')
    public async checkAndFillPaymasterBalance() {
        if (
            !this.canRunCron() ||
            this.inCheckingPaymasterBalance ||
            !isObject(CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT) ||
            !process.env.PAYMENT_SIGNER
        ) {
            return;
        }

        this.inCheckingPaymasterBalance = true;

        let currentChainId: any;
        let currentPaymasterAddress: any;

        for (const chainId in CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT) {
            try {
                currentChainId = chainId;
                currentPaymasterAddress = RPC_CONFIG[chainId].verifyingPaymaster;
                const provider = this.rpcService.getJsonRpcProvider(Number(chainId));
                const signerToPay = new Wallet(process.env.PAYMENT_SIGNER, provider);
                const contractVerifyPaymaster = new Contract(currentPaymasterAddress, verifyingPaymasterAbi, signerToPay);
                const balance: bigint = await contractVerifyPaymaster.getDeposit();
                const minBalance = CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT[chainId];

                Logger.log(`[Check paymaster balance] chainId=${chainId}, balance=${balance}`);

                const minBalanceWei = parseEther(minBalance.toString());
                if (BigNumber.from(balance).lt(minBalanceWei)) {
                    Logger.warn(
                        `[Paymaster deposit is too low] chainId=${chainId}, target=${parseEther(
                            minBalance.toString(),
                        )}, paymasterAddress=${currentPaymasterAddress}, balance=${balance.toString()}`,
                    );

                    let etherToDeposit = BigNumber.from(minBalanceWei).sub(balance);

                    const feeData: any = await getFeeDataFromParticle(Number(chainId));
                    Logger.log(
                        `[Deposit ether to verify paymaster] chainId=${chainId}, etherToDeposit=${etherToDeposit}, feeData=${JSON.stringify(
                            feeData,
                        )}`,
                    );
                    // force use gas price
                    const tx = await contractVerifyPaymaster.deposit.populateTransaction({
                        gasPrice: feeData.gasPrice,
                    });

                    const r = await signerToPay.sendTransaction({
                        type: 0,
                        ...tx,
                        value: etherToDeposit.toBigInt() + parseEther(String(CHAIN_BALANCE_RANGE[chainId.toString()] ?? '0.1')),
                    });

                    Logger.log(`[Paymaster Deposit Tx] chainId=${chainId}, txHash=${r.hash}`);
                    const balanceAfter: bigint = await contractVerifyPaymaster.getDeposit();

                    Alert.sendMessage(
                        `Fill Paymaster For ${currentPaymasterAddress} On ChainId ${currentChainId}, Current Balance: ${balanceAfter}`,
                        `Fill Paymaster Success`,
                    );
                }
            } catch (error) {
                Logger.error(`Error on chain ${currentChainId}`, error);

                Alert.sendMessage(
                    `Fill Paymaster Failed For ${currentPaymasterAddress} On ChainId ${currentChainId}\n${Helper.converErrorToString(error)}`,
                    `Fill Paymaster Error`,
                );
            }
        }

        this.inCheckingPaymasterBalance = false;
    }

    @Cron('* * * * * *')
    public async checkAndReleaseBlockSigners() {
        if (!this.canRunCron() || this.inCheckingAndReleaseBlockSigners) {
            return;
        }

        this.inCheckingAndReleaseBlockSigners = true;
        const blockedSigners = this.aaService.getAllBlockedSigners();
        if (blockedSigners.length <= 0) {
            this.inCheckingAndReleaseBlockSigners = false;
            return;
        }

        for (const blockedSigner of blockedSigners) {
            if (blockedSigner.info.reason === BLOCK_SIGNER_REASON.INSUFFICIENT_BALANCE) {
                const provider = this.rpcService.getJsonRpcProvider(blockedSigner.chainId);
                const balance = await provider.getBalance(blockedSigner.signerAddress);

                if (!CHAIN_SIGNER_MIN_BALANCE[blockedSigner.chainId]) {
                    continue;
                }

                const minEtherBalance = parseEther(String(CHAIN_SIGNER_MIN_BALANCE[blockedSigner.chainId]));
                if (BigNumber.from(balance).gte(minEtherBalance)) {
                    this.aaService.UnblockedSigner(blockedSigner.chainId, blockedSigner.signerAddress);
                    Alert.sendMessage(`Balance is enough, unblock signer ${blockedSigner.signerAddress}`);

                    const transaction = await this.transactionService.getTransactionById(blockedSigner.info.transactionId);
                    await handleLocalTransaction(this.connection, transaction, provider, this.rpcService, this.aaService);
                }
            }
        }

        this.inCheckingAndReleaseBlockSigners = false;
    }

    public stop() {
        this.canRun = false;
    }
}
