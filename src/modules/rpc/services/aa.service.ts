import { Injectable } from '@nestjs/common';
import { Wallet } from 'ethers';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';
import { BLOCK_SIGNER_REASON, BUNDLING_MODE, IS_DEVELOPMENT } from '../../../common/common-types';
import { Alert } from '../../../common/alert';
import { ConfigService } from '@nestjs/config';
import { UserOperationDocument } from '../schemas/user-operation.schema';

export enum TRANSACTION_EXTRA_STATUS {
    NONE,
    NONCE_TOO_LOW,
}

@Injectable()
export class AAService {
    private readonly blockedSigners: Map<string, any & { reason: BLOCK_SIGNER_REASON }> = new Map();
    private readonly lockedUserOperationIds: Set<string> = new Set();

    private bundlingMode: BUNDLING_MODE = IS_DEVELOPMENT && process.env.MANUAL_MODE ? BUNDLING_MODE.MANUAL : BUNDLING_MODE.AUTO;

    public constructor(
        public readonly userOperationService: UserOperationService,
        public readonly transactionService: TransactionService,
        public readonly configService: ConfigService,
    ) {}

    public getRandomSigners(chainId: number): Wallet[] {
        const signers = this.getSigners(chainId);

        return signers.sort(() => Math.random() - 0.5).filter((signer: Wallet) => !this.blockedSigners.has(`${chainId}-${signer.address}`));
    }

    public getSigners(chainId: number): Wallet[] {
        let pks = this.configService.get(`BUNDLER_SIGNERS_${chainId}`);
        if (!pks) {
            pks = this.configService.get('BUNDLER_SIGNERS').split(',');
        }

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
            if (this.lockedUserOperationIds.has(userOperation.id)) {
                continue;
            }

            this.lockedUserOperationIds.add(userOperation.id);
            unusedUserOperations.push(userOperation);
        }

        return unusedUserOperations;
    }

    public unlockUserOperations(userOperations: UserOperationDocument[]) {
        for (const userOperation of userOperations) {
            this.lockedUserOperationIds.delete(userOperation.id);
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
}
