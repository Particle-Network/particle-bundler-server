import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider, Wallet } from 'ethers';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';
import { BLOCK_SIGNER_REASON, BUNDLING_MODE, GAS_FEE_LEVEL, IS_DEVELOPMENT, PROCESS_NOTIFY_TYPE } from '../../../common/common-types';
import { Alert } from '../../../common/alert';
import { ConfigService } from '@nestjs/config';
import { UserOperationDocument } from '../schemas/user-operation.schema';
import { getFeeDataFromParticle } from '../aa/utils';
import { ProcessNotify } from '../../../common/process-notify';

export enum TRANSACTION_EXTRA_STATUS {
    NONE,
    NONCE_TOO_LOW,
}

const GAS_FEE_TIMEOUT = 5000; // 5s

@Injectable()
export class AAService {
    private readonly blockedSigners: Map<string, any & { reason: BLOCK_SIGNER_REASON }> = new Map();
    private readonly lockedUserOperationHashes: Set<string> = new Set();
    private readonly feeCaches: Map<number, { fee: any; timestamp: number }> = new Map();
    private readonly transactionCountCaches: Map<string, number> = new Map();
    private readonly userOpHashReceipts: Map<string, any> = new Map();

    private bundlingMode: BUNDLING_MODE = IS_DEVELOPMENT && process.env.MANUAL_MODE ? BUNDLING_MODE.MANUAL : BUNDLING_MODE.AUTO;

    public constructor(
        public readonly userOperationService: UserOperationService,
        public readonly transactionService: TransactionService,
        public readonly configService: ConfigService,
    ) {
        ProcessNotify.registerHandler((packet: any) => {
            if (packet.type === PROCESS_NOTIFY_TYPE.GET_GAS_FEE) {
                const { chainId, feeObj } = packet.data;
                Logger.log(`Get Gas Fee On Chain ${chainId} From Particle: ${JSON.stringify(feeObj)}`);

                if (!!chainId && !!feeObj) {
                    this.setFeeData(chainId, feeObj);
                }
            }

            if (packet.type === PROCESS_NOTIFY_TYPE.GET_TRANSACTION_COUNT) {
                const { chainId, address, nonce } = packet.data;
                Logger.log(`Get Transaction Count On Chain ${chainId} For ${address}: ${nonce}`);

                if (!!chainId && !!address) {
                    this.setTransactionCountLocalCache(chainId, address, nonce);
                }
            }

            if (packet.type === PROCESS_NOTIFY_TYPE.SET_RECEIPT) {
                const { chainId, userOpHashes, receipt } = packet.data;

                console.log(`Set Receipt On Chain ${chainId} For ${userOpHashes}`, receipt);

                if (!!chainId && !!userOpHashes && !!receipt) {
                    for (const userOpHash of userOpHashes) {
                        this.setUserOpHashReceipt(chainId, userOpHash, receipt);
                    }
                }
            }
        });
    }

    public getRandomSigners(chainId: number): Wallet[] {
        const signers = this.getSigners(chainId);

        return signers.sort(() => Math.random() - 0.5).filter((signer: Wallet) => !this.blockedSigners.has(`${chainId}-${signer.address}`));
    }

    public getSigners(chainId: number): Wallet[] {
        let pks = this.configService.get(`BUNDLER_SIGNERS_${chainId}`);
        if (!pks) {
            pks = this.configService.get('BUNDLER_SIGNERS');
        }

        pks = pks.split(',');

        return (pks = pks.filter((pk: string) => !!pk).map((privateKey: string) => new Wallet(privateKey)));
    }

    public setBlockedSigner(chainId: number, signerAddress: string, reason: BLOCK_SIGNER_REASON, options: any = {}) {
        options.reason = reason;
        this.blockedSigners.set(`${chainId}-${signerAddress}`, options);

        Alert.sendMessage(`${signerAddress} is blocked on chain ${chainId}`, `Block Signer On Chain ${chainId}`);
    }

    public UnblockedSigner(chainId: number, signerAddress: string) {
        const key = `${chainId}-${signerAddress}`;
        if (this.blockedSigners.has(key)) {
            this.blockedSigners.delete(key);
            Alert.sendMessage(`${signerAddress} is unblocked on chain ${chainId}`, `Unblock Signer On Chain ${chainId}`);
        }
    }

    public getAllBlockedSigners() {
        const blockedSigners: { chainId: number; signerAddress: string; info: any }[] = [];
        for (const [key, info] of this.blockedSigners) {
            const [chainId, signerAddress] = key.split('-');
            blockedSigners.push({
                chainId: Number(chainId),
                signerAddress,
                info,
            });
        }

        return blockedSigners;
    }

    public isBlockedSigner(chainId: number, signerAddress: string) {
        return this.blockedSigners.has(`${chainId}-${signerAddress}`);
    }

    public tryLockUserOperationsAndGetUnuseds(userOperations: UserOperationDocument[]): UserOperationDocument[] {
        const unusedUserOperations = [];
        for (const userOperation of userOperations) {
            const key = `${userOperation.chainId}-${userOperation.userOpHash}`;
            if (this.lockedUserOperationHashes.has(key)) {
                continue;
            }

            this.lockedUserOperationHashes.add(key);
            unusedUserOperations.push(userOperation);
        }

        return unusedUserOperations;
    }

    public unlockUserOperations(userOperations: UserOperationDocument[]) {
        for (const userOperation of userOperations) {
            const key = `${userOperation.chainId}-${userOperation.userOpHash}`;
            this.lockedUserOperationHashes.delete(key);
        }
    }

    // only for development
    public setBundlingMode(bundlingMode: BUNDLING_MODE) {
        if (!IS_DEVELOPMENT) {
            console.error('SetBundlingMode Failed, It is only for development');
            return;
        }

        this.bundlingMode = bundlingMode;
    }

    public getBundlingMode(): BUNDLING_MODE {
        return this.bundlingMode;
    }

    public async getFeeData(chainId: number) {
        if (this.feeCaches.has(chainId)) {
            const feeObj = this.feeCaches.get(chainId);
            if (Date.now() - feeObj.timestamp <= GAS_FEE_TIMEOUT) {
                return feeObj.fee;
            }
        }

        const feeObj = await getFeeDataFromParticle(chainId, GAS_FEE_LEVEL.MEDIUM);
        this.setFeeData(chainId, feeObj);
        ProcessNotify.sendMessages(PROCESS_NOTIFY_TYPE.GET_GAS_FEE, { chainId, feeObj });

        return feeObj;
    }

    private setFeeData(chainId: number, feeObj: any) {
        this.feeCaches.set(chainId, { fee: feeObj, timestamp: Date.now() });
    }

    public async getTransactionCountLocalCache(
        provider: JsonRpcProvider,
        chainId: number,
        address: string,
        forceLatest = false,
    ): Promise<number> {
        if (this.transactionCountCaches.has(`${chainId}-${address}`) && !forceLatest) {
            return this.transactionCountCaches.get(`${chainId}-${address}`);
        }

        const nonce = await provider.getTransactionCount(address, 'latest');
        this.setTransactionCountLocalCache(chainId, address, nonce);
        ProcessNotify.sendMessages(PROCESS_NOTIFY_TYPE.GET_TRANSACTION_COUNT, { chainId, address, nonce });

        return nonce;
    }

    // cache once is ok, because nonce will be used from database
    private setTransactionCountLocalCache(chainId: number, address: string, nonce: any) {
        this.transactionCountCaches.set(`${chainId}-${address}`, nonce);
    }

    public getUserOpHashReceipts(chainId: number, userOpHash: string): any {
        const key = `${chainId}-${userOpHash}`;
        if (this.userOpHashReceipts.has(key)) {
            return this.userOpHashReceipts.get(key);
        }

        return null;
    }

    private setUserOpHashReceipt(chainId: number, userOpHash: string, receipt: any) {
        const key = `${chainId}-${userOpHash}`;
        this.userOpHashReceipts.set(key, receipt);

        setTimeout(() => {
            this.userOpHashReceipts.delete(key);
        }, 10000);
    }
}
