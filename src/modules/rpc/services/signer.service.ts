import { Injectable, Logger } from '@nestjs/common';
import { Wallet } from 'ethers';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';
import { BLOCK_SIGNER_REASON } from '../../../common/common-types';
import { ConfigService } from '@nestjs/config';
import { LarkService } from '../../common/services/lark.service';

export enum TRANSACTION_EXTRA_STATUS {
    NONE,
    NONCE_TOO_LOW,
}

@Injectable()
export class SignerService {
    private readonly blockedSigners: Map<string, any & { reason: BLOCK_SIGNER_REASON }> = new Map();
    private readonly chainSigners: Map<number, Wallet[]> = new Map();
    private readonly cachedSignerPendingTxCount: Map<string, number> = new Map();
    private readonly signerDoneTransactionMaxNonce: Map<string, number> = new Map();

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

    public async incrChainSignerPendingTxCount(chainId: number, address: string) {
        const cacheKey = this.keyCacheChainSignerPendingTxCount(chainId, address);
        const targetSignerPendingTxCount = await this.getChainSignerPendingTxCount(chainId, address);
        this.cachedSignerPendingTxCount.set(cacheKey, targetSignerPendingTxCount + 1);

        Logger.debug(`[SignerService] IncrChainSignerPendingTxCount: ${address} | ${targetSignerPendingTxCount + 1}`);
    }

    public async decrChainSignerPendingTxCount(chainId: number, address: string) {
        const cacheKey = this.keyCacheChainSignerPendingTxCount(chainId, address);
        const targetSignerPendingTxCount = await this.getChainSignerPendingTxCount(chainId, address);
        if (targetSignerPendingTxCount > 0) {
            this.cachedSignerPendingTxCount.set(cacheKey, targetSignerPendingTxCount - 1);
        }

        Logger.debug(`[SignerService] DecrChainSignerPendingTxCount: ${address} | ${targetSignerPendingTxCount - 1}`);
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
        return `${chainId}:${address.toLowerCase()}`;
    }

    public setSignerDoneTransactionMaxNonce(chainId: number, from: string, nonce: number) {
        const key = this.keySignerDoneTransactionMaxNonce(chainId, from);
        if (this.signerDoneTransactionMaxNonce.has(key) && this.signerDoneTransactionMaxNonce.get(key) >= nonce) {
            return;
        }

        this.signerDoneTransactionMaxNonce.set(key, nonce);
    }

    public getSignerDoneTransactionMaxNonce(chainId: number, from: string): number {
        return this.signerDoneTransactionMaxNonce.get(this.keySignerDoneTransactionMaxNonce(chainId, from)) || 0;
    }

    private keySignerDoneTransactionMaxNonce(chainId: number, from: string) {
        return `${chainId}-${from.toLowerCase()}`;
    }
}
