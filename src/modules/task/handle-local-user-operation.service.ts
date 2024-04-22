import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AAService } from '../rpc/services/aa.service';
import { TransactionService } from '../rpc/services/transaction.service';
import { IS_DEVELOPMENT, IS_PRODUCTION, PROCESS_EVENT_TYPE, keyLockSigner } from '../../common/common-types';
import { Helper } from '../../common/helper';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { Cron } from '@nestjs/schedule';
import { getBundlerChainConfig } from '../../configs/bundler-common';
import { Wallet } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { ProcessEventEmitter } from '../../common/process-event-emitter';
import { LarkService } from '../common/services/lark.service';
import { waitSeconds } from '../rpc/aa/utils';
import { HandleLocalTransactionService } from './handle-local-transaction.service';
import { HandlePendingTransactionService } from './handle-pending-transaction.service';
import { HandlePendingUserOperationService } from './handle-pending-user-operation.service';

@Injectable()
export class HandleLocalUserOperationService {
    private readonly lockedUserOperationHashes: Set<string> = new Set();
    private readonly lockChainSigner: Set<string> = new Set();

    public constructor(
        private readonly configService: ConfigService,
        private readonly aaService: AAService,
        private readonly transactionService: TransactionService,
        private readonly larkService: LarkService,
        private readonly userOperationService: UserOperationService,
        private readonly handlePendingUserOperationService: HandlePendingUserOperationService,
    ) {
        ProcessEventEmitter.registerHandler(PROCESS_EVENT_TYPE.CREATE_USER_OPERATION, this.onSealUserOps.bind(this));
    }

    private onSealUserOps(packet: any) {
        const { chainId, userOpDoc } = packet.data;
        if (!!chainId && !!userOpDoc) {
            this.sealUserOps([userOpDoc]);
        }
    }

    @Cron('* * * * * *')
    public async sealUserOps(userOpDocs?: any[]) {
        if (!this.canRunCron()) {
            return;
        }

        try {
            let userOperations = userOpDocs ?? (await this.userOperationService.getLocalUserOperations());
            userOperations = this.tryLockUserOperationsAndGetUnuseds(userOperations);
            if (userOperations.length <= 0) {
                return;
            }

            console.log(`[SealUserOps] UserOpLength: ${userOperations.length}`);

            const userOperationsByChainId: any = {};
            for (const userOperation of userOperations) {
                if (!userOperationsByChainId[userOperation.chainId]) {
                    userOperationsByChainId[userOperation.chainId] = [];
                }

                userOperationsByChainId[userOperation.chainId].push(userOperation);
            }

            const chainIds = Object.keys(userOperationsByChainId);
            for (const chainId of chainIds) {
                // warning need to delete unused cache
                this.assignSignerAndSealUserOps(Number(chainId), userOperationsByChainId[chainId]);
            }
        } catch (error) {
            if (!IS_PRODUCTION) {
                console.error(`Seal User Ops Error`, error);
            }

            this.larkService.sendMessage(`Seal User Ops Error: ${Helper.converErrorToString(error)}`);
        }
    }

    private async assignSignerAndSealUserOps(chainId: number, userOperations: UserOperationDocument[]) {
        const { signer: targetSigner, canMakeTxCount } = await this.waitForASigner(chainId);
        if (!targetSigner) {
            console.warn(`No signer available on ${chainId}`);
            this.unlockUserOperations(userOperations);
            return;
        }

        const unhandledUserOperations = await this.handlePendingUserOperationService.handleLocalUserOperations(chainId, targetSigner, userOperations, canMakeTxCount);
        this.lockChainSigner.delete(keyLockSigner(chainId, targetSigner.address));

        await waitSeconds(2);

        // TODO
        this.aaService.unlockUserOperations(userOperations); // unlock left userOperations
    }

    private async waitForASigner(chainId: number): Promise<{ signer: Wallet; canMakeTxCount: number }> {
        let targetSigner: Wallet;
        const randomValidSigners = this.aaService.getRandomValidSigners(chainId);
        for (let index = 0; index < randomValidSigners.length; index++) {
            const signer = randomValidSigners[index];
            if (!this.lockChainSigner.has(keyLockSigner(chainId, signer.address))) {
                this.lockChainSigner.add(keyLockSigner(chainId, signer.address));
                targetSigner = signer;
                break;
            }
        }

        if (!targetSigner) {
            return { signer: null, canMakeTxCount: 0 };
        }

        const bundlerConfig = getBundlerChainConfig(chainId);
        const targetSignerPendingTxCount = await this.transactionService.getPendingTransactionCountBySigner(chainId, targetSigner.address);
        if (targetSignerPendingTxCount >= bundlerConfig.pendingTransactionSignerHandleLimit) {
            this.larkService.sendMessage(`Signer ${targetSigner.address} is pending On Chain ${chainId}`);
            this.lockChainSigner.delete(keyLockSigner(chainId, targetSigner.address));
            targetSigner = null;
        }

        return { signer: targetSigner, canMakeTxCount: bundlerConfig.pendingTransactionSignerHandleLimit - targetSignerPendingTxCount };
    }

    private tryLockUserOperationsAndGetUnuseds(userOperations: UserOperationDocument[]): UserOperationDocument[] {
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

    private unlockUserOperations(userOperations: UserOperationDocument[]) {
        for (const userOperation of userOperations) {
            const key = `${userOperation.chainId}-${userOperation.userOpHash}`;
            this.lockedUserOperationHashes.delete(key);
        }
    }

    private canRunCron() {
        if (!!process.env.DISABLE_TASK) {
            return false;
        }

        if (IS_DEVELOPMENT) {
            return true;
        }

        return this.configService.get('NODE_APP_INSTANCE') === '0';
    }
}
