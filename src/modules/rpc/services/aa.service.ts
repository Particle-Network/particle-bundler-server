import { Injectable } from '@nestjs/common';
import { Wallet } from 'ethers';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';
import { Http2Service } from '../../../http2/http2.service';
import { getPrivateKeyMap } from '../../../configs/bundler-config';
import { BUNDLING_MODE, IS_DEVELOPMENT } from '../../../common/common-types';

export enum TRANSACTION_EXTRA_STATUS {
    NONE,
    NONCE_TOO_LOW,
}

@Injectable()
export class AAService {
    private readonly blockedSigners: Set<string> = new Set();
    private readonly transactionInSending: Set<string> = new Set();
    private readonly transactionInFinishing: Set<string> = new Set();
    private readonly lockedUserOpHash: Set<string> = new Set();
    private readonly transactionExtraStatus: Map<string, number> = new Map();

    private bundlingMode: BUNDLING_MODE = IS_DEVELOPMENT && process.env.MANUAL_MODE ? BUNDLING_MODE.MANUAL : BUNDLING_MODE.AUTO;

    public constructor(
        public readonly userOperationService: UserOperationService,
        public readonly transactionService: TransactionService,
        public readonly http2Service: Http2Service,
    ) {}

    public getRandomSigners(chainId: number): Wallet[] {
        const signers = Object.values(getPrivateKeyMap(chainId)).map((privateKey: string) => new Wallet(privateKey));

        return signers.sort(() => Math.random() - 0.5).filter((signer: Wallet) => !this.blockedSigners.has(`${chainId}-${signer.address}`));
    }

    public setBlockedSigner(chainId: number, signerAddress: string) {
        this.blockedSigners.add(`${chainId}-${signerAddress}`);

        this.http2Service.sendLarkMessage(`${signerAddress} is blocked on chain ${chainId}`, `Block Signer On Chain ${chainId}`);
    }

    public UnblockedSigner(chainId: number, signerAddress: string) {
        const key = `${chainId}-${signerAddress}`;
        if (this.blockedSigners.has(key)) {
            this.blockedSigners.delete(key);
            this.http2Service.sendLarkMessage(`${signerAddress} is unblocked on chain ${chainId}`, `Unblock Signer On Chain ${chainId}`);
        }
    }

    public isBlockedSigner(chainId: number, signerAddress: string) {
        return this.blockedSigners.has(`${chainId}-${signerAddress}`);
    }

    public clearSendingTx(signedTx: string) {
        this.transactionInSending.delete(signedTx);
    }

    public isTxSending(signedTx: string): boolean {
        return this.transactionInSending.has(signedTx);
    }

    public setSendingTx(signedTx: string) {
        this.transactionInSending.add(signedTx);
    }

    public clearFinishingTx(signedTx: string) {
        this.transactionInFinishing.delete(signedTx);
    }

    public isTxFinishing(signedTx: string): boolean {
        return this.transactionInFinishing.has(signedTx);
    }

    public setFinishingTx(signedTx: string) {
        this.transactionInFinishing.add(signedTx);
    }

    public getLockedUserOpHashes(): string[] {
        return Array.from(this.lockedUserOpHash);
    }

    public unlockUserOpHashes(userOpHashes: string[]) {
        for (const userOpHash of userOpHashes) {
            this.lockedUserOpHash.delete(userOpHash);
        }
    }

    public lockUserOpHashes(userOpHashes: string[]) {
        for (const userOpHash of userOpHashes) {
            this.lockedUserOpHash.add(userOpHash);
        }
    }

    public setTransactionExtraStatus(chainId: number, txHash: string, status: TRANSACTION_EXTRA_STATUS) {
        this.transactionExtraStatus.set(`${chainId}-${txHash}`, status);
    }

    public getTransactionExtraStatus(chainId: number, txHash: string): TRANSACTION_EXTRA_STATUS {
        const key = `${chainId}-${txHash}`;
        if (!this.transactionExtraStatus.has(key)) {
            return TRANSACTION_EXTRA_STATUS.NONE;
        }

        return this.transactionExtraStatus.get(key);
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
