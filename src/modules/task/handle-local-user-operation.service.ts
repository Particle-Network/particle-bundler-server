import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AAService } from '../rpc/services/aa.service';
import { TransactionService } from '../rpc/services/transaction.service';
import {
    IS_DEVELOPMENT,
    IS_PRODUCTION,
    PROCESS_EVENT_TYPE,
    keyLockSigner,
} from '../../common/common-types';
import { Helper } from '../../common/helper';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { Cron } from '@nestjs/schedule';
import { getBundlerChainConfig } from '../../configs/bundler-common';
import { Wallet } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { ProcessEventEmitter } from '../../common/process-event-emitter';
import { LarkService } from '../common/services/lark.service';
import { HandlePendingUserOperationService } from './handle-pending-user-operation.service';
import { waitSeconds } from '../rpc/aa/utils';

@Injectable()
export class HandleLocalUserOperationService {
    private readonly lockedUserOperationHashes: Set<string> = new Set();
    private readonly lockChainSigner: Map<string, boolean> = new Map();

    public constructor(
        private readonly configService: ConfigService,
        private readonly aaService: AAService,
        private readonly transactionService: TransactionService,
        private readonly larkService: LarkService,
        private readonly userOperationService: UserOperationService,
        private readonly taskHandlePendingUserOperationService: HandlePendingUserOperationService,
    ) {
        ProcessEventEmitter.registerHandler(PROCESS_EVENT_TYPE.CREATE_USER_OPERATION, this.onSealUserOps.bind(this));
    }

    private inSealingUserOps = false; // should be delete ? it will decrease the performance

    private onSealUserOps(packet: any) {
        const { chainId, userOpDoc } = packet.data;
        if (!!chainId && !!userOpDoc) {
            this.sealUserOps([userOpDoc]);
        }
    }

    @Cron('* * * * * *')
    public async sealUserOps(userOpDocs?: any[]) {
        if (!this.canRunCron() || this.inSealingUserOps) {
            return;
        }

        this.inSealingUserOps = true;

        try {
            let userOperations = userOpDocs ?? (await this.userOperationService.getLocalUserOperations());
            userOperations = this.tryLockUserOperationsAndGetUnuseds(userOperations);
            if (userOperations.length <= 0) {
                this.inSealingUserOps = false;
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

        this.inSealingUserOps = false;
    }

    private async assignSignerAndSealUserOps(chainId: number, userOperations: UserOperationDocument[]) {
        const targetSigner: Wallet = await this.waitForASigner(chainId);
        if (!targetSigner) {
            console.warn(`No signer available on ${chainId}`);
            this.unlockUserOperations(userOperations);
            return;
        }

        const unhandledUserOperations = await this.taskHandlePendingUserOperationService.handleLocalUserOperations(chainId, targetSigner, userOperations);
        this.lockChainSigner.set(keyLockSigner(chainId, targetSigner.address), false);

        await waitSeconds(2);
        
        // TODO
        this.aaService.unlockUserOperations(userOperations); // unlock left userOperations
    }

    private async waitForASigner(chainId: number): Promise<Wallet> {
        let targetSigner: Wallet;
        const randomSigners = this.aaService.getRandomValidSigners(chainId);
        for (let index = 0; index < randomSigners.length; index++) {
            const signer = randomSigners[index];
            if (!this.lockChainSigner.get(keyLockSigner(chainId, signer.address))) {
                this.lockChainSigner.set(keyLockSigner(chainId, signer.address), true);
                targetSigner = signer;
                break;
            }
        }

        if (!targetSigner) {
            return null;
        }

        const bundlerConfig = getBundlerChainConfig(chainId);
        const targetSignerPendingTxCount = await this.transactionService.getPendingTransactionCountBySigner(chainId, targetSigner.address);
        if (targetSignerPendingTxCount >= bundlerConfig.pendingTransactionSignerHandleLimit) {
            this.larkService.sendMessage(`Signer ${targetSigner.address} is pending On Chain ${chainId}`);
            this.lockChainSigner.set(keyLockSigner(chainId, targetSigner.address), false);
            targetSigner = null;
        }

        return targetSigner;
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
