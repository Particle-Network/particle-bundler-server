import { Injectable } from '@nestjs/common';
import { JsonRpcProvider, Wallet } from 'ethers';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';
import {
    BLOCK_SIGNER_REASON,
    CACHE_GAS_FEE_TIMEOUT,
    CACHE_TRANSACTION_COUNT_TIMEOUT,
    GAS_FEE_LEVEL,
    keyCacheChainFeeData,
    keyCacheChainSignerTransactionCount,
} from '../../../common/common-types';
import { ConfigService } from '@nestjs/config';
import { getFeeDataFromParticle } from '../aa/utils';
import { LarkService } from '../../common/services/lark.service';
import P2PCache from '../../../common/p2p-cache';

export enum TRANSACTION_EXTRA_STATUS {
    NONE,
    NONCE_TOO_LOW,
}

@Injectable()
export class SignerService {
    private readonly blockedSigners: Map<string, any & { reason: BLOCK_SIGNER_REASON }> = new Map();
    private readonly chainSigners: Map<number, Wallet[]> = new Map();
    private readonly cachedSignerPendingTxCount: Map<string, number> = new Map();

    public constructor(
        public readonly userOperationService: UserOperationService,
        public readonly transactionService: TransactionService,
        public readonly configService: ConfigService,
        public readonly larkService: LarkService,
    ) {}

    public getRandomValidSigners(chainId: number): Wallet[] {
        const signers = this.getChainSigners(chainId);

        return signers.sort(() => Math.random() - 0.5).filter((signer: Wallet) => !this.blockedSigners.has(`${chainId}-${signer.address}`));
    }

    public getChainSigners(chainId: number): Wallet[] {
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

    public async getTransactionCountWithCache(
        provider: JsonRpcProvider,
        chainId: number,
        address: string,
        forceLatest: boolean = false,
    ): Promise<number> {
        try {
            const cacheKey = keyCacheChainSignerTransactionCount(chainId, address);
            let nonce = P2PCache.get(cacheKey);
            if (!forceLatest && !!nonce) {
                return nonce;
            }

            nonce = await provider.getTransactionCount(address, 'latest');
            P2PCache.set(cacheKey, nonce, CACHE_TRANSACTION_COUNT_TIMEOUT);

            return nonce;
        } catch (error) {
            return 0;
        }
    }

    public trySetTransactionCountLocalCache(chainId: number, address: string, nonce: number) {
        const cacheKey = keyCacheChainSignerTransactionCount(chainId, address);

        const cachedNonce = P2PCache.get(cacheKey) ?? 0;
        if (nonce > cachedNonce) {
            P2PCache.set(cacheKey, nonce, CACHE_TRANSACTION_COUNT_TIMEOUT);
        }
    }

    public async incrChainSignerPendingTxCount(chainId: number, address: string) {
        const cacheKey = this.keyCacheChainSignerPendingTxCount(chainId, address);
        const targetSignerPendingTxCount = await this.getChainSignerPendingTxCount(chainId, address);
        this.cachedSignerPendingTxCount.set(cacheKey, targetSignerPendingTxCount + 1);
    }

    public async decrChainSignerPendingTxCount(chainId: number, address: string) {
        const cacheKey = this.keyCacheChainSignerPendingTxCount(chainId, address);
        const targetSignerPendingTxCount = await this.getChainSignerPendingTxCount(chainId, address);
        if (targetSignerPendingTxCount > 0) {
            this.cachedSignerPendingTxCount.set(cacheKey, targetSignerPendingTxCount - 1);
        }
    }

    public async getChainSignerPendingTxCount(chainId: number, address: string): Promise<number> {
        const cacheKey = this.keyCacheChainSignerPendingTxCount(chainId, address);
        if (!this.cachedSignerPendingTxCount.has(cacheKey)) {
            const targetSignerPendingTxCount = await this.transactionService.getPendingTransactionCountBySigner(chainId, address);
            this.cachedSignerPendingTxCount.set(cacheKey, targetSignerPendingTxCount);
        }

        return this.cachedSignerPendingTxCount.get(cacheKey);
    }

    private keyCacheChainSignerPendingTxCount(chainId: number, address: string) {
        return `${chainId}:${address}`;
    }
}
