import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider, Wallet } from 'ethers';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';
import {
    BLOCK_SIGNER_REASON,
    CACHE_GAS_FEE_TIMEOUT,
    CACHE_TRANSACTION_COUINT_TIMEOUT,
    GAS_FEE_LEVEL,
    IS_DEVELOPMENT,
    PROCESS_EVENT_TYPE,
    keyCacheChainFeeData,
    keyCacheChainSignerTransactionCount,
} from '../../../common/common-types';
import { ConfigService } from '@nestjs/config';
import { UserOperationDocument } from '../schemas/user-operation.schema';
import { getFeeDataFromParticle } from '../aa/utils';
import { LarkService } from '../../common/services/lark.service';
import P2PCache from '../../../common/p2p-cache';

export enum TRANSACTION_EXTRA_STATUS {
    NONE,
    NONCE_TOO_LOW,
}

@Injectable()
export class AAService {
    private readonly blockedSigners: Map<string, any & { reason: BLOCK_SIGNER_REASON }> = new Map();
    private readonly lockedUserOperationHashes: Set<string> = new Set();
    private readonly feeCaches: Map<number, { fee: any; timestamp: number }> = new Map();
    private readonly transactionCountCaches: Map<string, number> = new Map();
    private readonly userOpHashReceipts: Map<string, any> = new Map();

    private readonly chainSigners: Map<number, Wallet[]> = new Map();

    public constructor(
        public readonly userOperationService: UserOperationService,
        public readonly transactionService: TransactionService,
        public readonly configService: ConfigService,
        public readonly larkService: LarkService,
    ) {
        // ProcessNotify.registerHandler(PROCESS_NOTIFY_TYPE.GET_GAS_FEE, this.onSetFeeData.bind(this));
        // ProcessNotify.registerHandler(PROCESS_NOTIFY_TYPE.GET_TRANSACTION_COUNT, this.onSetTransactionCountLocalCache.bind(this));
        // ProcessNotify.registerHandler(PROCESS_NOTIFY_TYPE.SET_RECEIPT, this.onSetUserOpHashReceipt.bind(this));
    }

    public getRandomValidSigners(chainId: number): Wallet[] {
        const signers = this.getSigners(chainId);

        return signers.sort(() => Math.random() - 0.5).filter((signer: Wallet) => !this.blockedSigners.has(`${chainId}-${signer.address}`));
    }

    // TODO refactor name
    public getSigners(chainId: number): Wallet[] {
        if (this.chainSigners.has(chainId)) {
            return this.chainSigners.get(chainId);
        }

        let pks = this.configService.get(`BUNDLER_SIGNERS_${chainId}`);
        if (!pks) {
            pks = this.configService.get('BUNDLER_SIGNERS');
        }

        pks = pks.split(',');
        const chainSigners = (pks = pks.filter((pk: string) => !!pk).map((privateKey: string) => new Wallet(privateKey)));

        this.chainSigners.set(chainId, chainSigners);
        return chainSigners;
    }

    public setBlockedSigner(chainId: number, signerAddress: string, reason: BLOCK_SIGNER_REASON, options: any = {}) {
        options.reason = reason;
        this.blockedSigners.set(`${chainId}-${signerAddress}`, options);
        this.larkService.sendMessage(`${signerAddress} is blocked on chain ${chainId}`, `Block Signer On Chain ${chainId}`);
    }

    public UnblockedSigner(chainId: number, signerAddress: string) {
        const key = `${chainId}-${signerAddress}`;
        if (this.blockedSigners.has(key)) {
            this.blockedSigners.delete(key);
            this.larkService.sendMessage(`${signerAddress} is unblocked on chain ${chainId}`, `Unblock Signer On Chain ${chainId}`);
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

    public async getFeeData(chainId: number) {
        const cacheKey = keyCacheChainFeeData(chainId);
        if (P2PCache.has(cacheKey)) {
            const feeObj = P2PCache.get(cacheKey);
            if (Date.now() - feeObj.timestamp <= CACHE_GAS_FEE_TIMEOUT) {
                return feeObj.feeData;
            }
        }

        const feeData = await getFeeDataFromParticle(chainId, GAS_FEE_LEVEL.MEDIUM);
        P2PCache.set(cacheKey, { feeData, timestamp: Date.now() });

        return feeData;
    }

    public async getTransactionCountLocalCache(
        provider: JsonRpcProvider,
        chainId: number,
        address: string,
        forceLatest = false,
    ): Promise<number> {
        const cacheKey = keyCacheChainSignerTransactionCount(chainId, address);
        if (!forceLatest && P2PCache.has(cacheKey)) {
            const nonceObj = P2PCache.get(cacheKey);
            if (Date.now() - nonceObj.timestamp <= CACHE_TRANSACTION_COUINT_TIMEOUT) {
                return nonceObj.nonce;
            }
        }

        const nonce = await provider.getTransactionCount(address, 'latest');
        P2PCache.set(cacheKey, { nonce, timestamp: Date.now() });

        return nonce;
    }

    public trySetTransactionCountLocalCache(chainId: number, address: string, nonce: number) {
        const cacheKey = keyCacheChainSignerTransactionCount(chainId, address);

        let currentNonce: number = -1;
        if (P2PCache.has(cacheKey)) {
            const nonceObj = P2PCache.get(cacheKey);
            currentNonce = nonceObj.nonce;
        }

        if (nonce > currentNonce) {
            P2PCache.set(cacheKey, { nonce, timestamp: Date.now() });
        }
    }

    public getUserOpHashReceipts(chainId: number, userOpHash: string): any {
        const key = `${chainId}-${userOpHash}`;
        if (this.userOpHashReceipts.has(key)) {
            return this.userOpHashReceipts.get(key);
        }

        return null;
    }

    private onSetUserOpHashReceipt(packet: any) {
        const { chainId, userOpHashes, receipt } = packet.data;
        console.log(`Set Receipt On Chain ${chainId} For ${userOpHashes}`, receipt);

        if (!!chainId && !!userOpHashes && !!receipt) {
            for (const userOpHash of userOpHashes) {
                this.setUserOpHashReceipt(chainId, userOpHash, receipt);
            }
        }
    }

    private setUserOpHashReceipt(chainId: number, userOpHash: string, receipt: any) {
        const key = `${chainId}-${userOpHash}`;
        this.userOpHashReceipts.set(key, receipt);

        setTimeout(() => {
            this.userOpHashReceipts.delete(key);
        }, 10000);
    }
}
