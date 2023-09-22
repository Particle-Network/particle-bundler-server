import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AAService } from '../rpc/services/aa.service';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { RpcService } from '../rpc/services/rpc.service';
import { TransactionService } from '../rpc/services/transaction.service';
import {
    BUNDLING_MODE,
    IS_DEVELOPMENT,
    IS_PARTICLE,
    REDIS_TASK_CONNECTION_NAME,
    keyEventSendUserOperation,
    keyLockChainId,
    keyLockSigner,
} from '../../common/common-types';
import { TRANSACTION_STATUS, TransactionDocument } from '../rpc/schemas/transaction.schema';
import { Http2Service } from '../../http2/http2.service';
import { Helper } from '../../common/helper';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { handlePendingTransaction, tryIncrTransactionGasPrice } from '../rpc/shared/handle-pending-transactions';
import { handleLocalUserOperations } from '../rpc/shared/handle-local-user-operations';
import { Cron } from '@nestjs/schedule';
import Lock from '../../common/global-lock';
import { handleLocalTransaction } from '../rpc/shared/handle-local-transactions';
import {
    CHAIN_SIGNER_MIN_BALANCE,
    CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT,
    EVM_CHAIN_ID_NOT_SUPPORT_1559,
    PAYMENT_SIGNER,
    RPC_CONFIG,
    getPrivateKeyMap,
} from '../../configs/bundler-config';
import { Contract, Wallet, parseEther } from 'ethers';
import verifyingPaymasterAbi from '../rpc/aa/verifying-paymaster-abi';
import { BigNumber } from '../../common/bignumber';

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
        private readonly http2Service: Http2Service,
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
                console.log('sealUserOps', chainId);
                this.sealUserOpsByDuration(Number(chainId));
            }
        }
    }

    private async sealUserOpsByDuration(chainId: number) {
        this.sealUserOpsFlag.set(chainId, true);

        const targetSigner: Wallet = await this.waitForASigner(chainId);
        if (!targetSigner) {
            console.error('No signer available', chainId);
            return;
        }

        await Lock.acquire(keyLockChainId(chainId));

        console.log('sealUserOpsByDuration acquire', chainId, targetSigner.address);
        if (!this.sealUserOpsFlag.get(chainId)) {
            console.log('sealUserOpsByDuration release', '!this.sealUserOpsFlag.get(chainId)', chainId, targetSigner.address);

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
        console.log(`sealUserOpsByDuration`, startAt, endAt, chainId, userOperations.length);

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
            if (index !== randomSigners.length - 1) {
                if (!Lock.isAcquired(keyLockSigner(chainId, signer.address))) {
                    await Lock.acquire(keyLockSigner(chainId, signer.address));
                    targetSigner = signer;
                    break;
                }
            } else {
                await Lock.acquire(keyLockSigner(chainId, signer.address));
                targetSigner = signer;
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
            console.error(error);
            this.http2Service.sendLarkMessage(`Handle Local Transactions Error: ${Helper.converErrorToString(error)}`);
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

            console.log('getReceiptAndHandlePendingTransactions', receipts.length);
            if (receipts.some((r) => !!r)) {
                console.log(
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
            console.error('getReceiptAndHandlePendingTransactions error', error);

            this.http2Service.sendLarkMessage(`getReceiptAndHandlePendingTransactions Error: ${Helper.converErrorToString(error)}`);
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
        if (!IS_PARTICLE || !this.canRunCron() || this.inCheckingSignerBalance) {
            return;
        }

        this.inCheckingSignerBalance = true;

        let currentChainId: any;
        let currentAddress: any;

        try {
            for (const chainId in CHAIN_SIGNER_MIN_BALANCE) {
                currentChainId = chainId;
                const provider = this.rpcService.getJsonRpcProvider(Number(chainId));

                const minEtherBalance = CHAIN_SIGNER_MIN_BALANCE[chainId];
                const signers = Object.keys(getPrivateKeyMap(Number(chainId)));
                for (const address of signers) {
                    currentAddress = address;

                    const balance = await provider.getBalance(address);
                    const balanceEther = BigNumber.from(balance).div(1e9).toNumber() / 1e9;
                    console.log('Check signer balance', chainId, address, balanceEther);

                    if (balanceEther < minEtherBalance) {
                        const etherToSend = (minEtherBalance - balanceEther).toFixed(10);
                        console.log('Send ether to signer', chainId, address, etherToSend);
                        const signerToPay = new Wallet(PAYMENT_SIGNER, provider);

                        const tx = await signerToPay.sendTransaction({
                            type: EVM_CHAIN_ID_NOT_SUPPORT_1559.includes(Number(chainId)) ? 0 : 2,
                            to: address,
                            value: parseEther(etherToSend.toString()) + parseEther('0.1'),
                        });

                        console.log('Sent tx', chainId, tx.hash);
                        await tx.wait();
                        const balanceAfter = await provider.getBalance(address);
                        const balanceEtherAfter = BigNumber.from(balanceAfter).div(1e9).toNumber() / 1e9;
                        console.log('After send', chainId, address, balanceEtherAfter);

                        this.aaService.UnblockedSigner(Number(chainId), address);

                        this.http2Service.sendLarkMessage(
                            `Fill Signer For ${currentAddress} On ChainId ${currentChainId}, Current Balance: ${balanceAfter}`,
                            `Fill Signer Success`,
                        );
                    }
                }
            }
        } catch (error) {
            this.http2Service.sendLarkMessage(
                `Fill Signer Failed For ${currentAddress} On ChainId ${currentChainId}\n${Helper.converErrorToString(error)}`,
                `Fill Signer Error`,
            );
        }

        this.inCheckingSignerBalance = false;
    }

    @Cron('0 * * * * *')
    public async checkAndFillPaymasterBalance() {
        if (!IS_PARTICLE || !this.canRunCron() || this.inCheckingPaymasterBalance) {
            return;
        }

        this.inCheckingPaymasterBalance = true;

        let currentChainId: any;
        let currentPaymasterAddress: any;

        try {
            for (const chainId in CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT) {
                currentChainId = chainId;
                currentPaymasterAddress = RPC_CONFIG[chainId].verifyingPaymaster;
                const provider = this.rpcService.getJsonRpcProvider(Number(chainId));
                const signerToPay = new Wallet(PAYMENT_SIGNER, provider);
                const contractVerifyPaymaster = new Contract(currentPaymasterAddress, verifyingPaymasterAbi, signerToPay);
                const balance: bigint = await contractVerifyPaymaster.getDeposit();
                const minBalance = CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT[chainId];

                const minBalanceWei = parseEther(minBalance.toString());
                if (BigNumber.from(balance).lt(minBalanceWei)) {
                    console.log(
                        `Paymaster deposit is less than ${parseEther(minBalance.toString())}`,
                        chainId,
                        currentPaymasterAddress,
                        balance.toString(),
                    );

                    let etherToDeposit = BigNumber.from(minBalanceWei).sub(balance);
                    console.log('Deposit ether to verify paymaster', chainId, currentPaymasterAddress, etherToDeposit.toString());
                    const r = await contractVerifyPaymaster.deposit({
                        type: EVM_CHAIN_ID_NOT_SUPPORT_1559.includes(Number(chainId)) ? 0 : 2,
                        value: etherToDeposit.add(parseEther('0.1')).toHexString(),
                    });

                    console.log('Deposit tx', chainId, r.hash);
                    const balanceAfter: bigint = await contractVerifyPaymaster.getDeposit();

                    this.http2Service.sendLarkMessage(
                        `Fill Paymaster For ${currentPaymasterAddress} On ChainId ${currentChainId}, Current Balance: ${balanceAfter}`,
                        `Fill Paymaster Success`,
                    );
                }
            }
        } catch (error) {
            this.http2Service.sendLarkMessage(
                `Fill Paymaster Failed For ${currentPaymasterAddress} On ChainId ${currentChainId}\n${Helper.converErrorToString(error)}`,
                `Fill Paymaster Error`,
            );
        }

        this.inCheckingPaymasterBalance = false;
    }

    public stop() {
        this.canRun = false;
    }
}
