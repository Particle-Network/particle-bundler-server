import { Injectable } from '@nestjs/common';
import { AAService } from '../rpc/services/aa.service';
import { TransactionService } from '../rpc/services/transaction.service';
import { IS_PRODUCTION, PROCESS_EVENT_TYPE, keyLockSigner } from '../../common/common-types';
import { Helper } from '../../common/helper';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { Cron } from '@nestjs/schedule';
import { getBundlerChainConfig } from '../../configs/bundler-common';
import { Wallet, toBeHex } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { ProcessEventEmitter } from '../../common/process-event-emitter';
import { LarkService } from '../common/services/lark.service';
import { calcUserOpTotalGasLimit, canRunCron, waitSeconds } from '../rpc/aa/utils';
import { HandlePendingUserOperationService } from './handle-pending-user-operation.service';

@Injectable()
export class HandleLocalUserOperationService {
    private readonly lockedUserOperationHashes: Set<string> = new Set();
    private readonly lockChainSigner: Set<string> = new Set();

    public constructor(
        private readonly aaService: AAService,
        private readonly transactionService: TransactionService,
        private readonly larkService: LarkService,
        private readonly userOperationService: UserOperationService,
        private readonly handlePendingUserOperationService: HandlePendingUserOperationService,
    ) {
        ProcessEventEmitter.registerHandler(PROCESS_EVENT_TYPE.CREATE_USER_OPERATION, this.onSealUserOps.bind(this));
    }

    private onSealUserOps(packet: any) {
        const userOpDoc = packet.data;
        if (!!userOpDoc) {
            this.sealUserOps([userOpDoc]);
        }
    }

    @Cron('* * * * * *')
    public async sealUserOps(userOpDocs?: any[]) {
        if (!canRunCron()) {
            return;
        }

        try {
            let userOperations = userOpDocs ?? (await this.userOperationService.getLocalUserOperations(500));
            userOperations = this.tryLockUserOperationsAndGetUnuseds(userOperations);
            if (userOperations.length <= 0) {
                return;
            }

            const userOperationsByChainId: any = {};
            for (const userOperation of userOperations) {
                userOperation.id = userOperation._id.toString();
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

        const { packedBundles, unusedUserOperations, userOperationsToDelete } = this.packUserOperationsForSigner(
            chainId,
            userOperations,
            canMakeTxCount,
        );

        this.unlockUserOperations(unusedUserOperations);
        await this.handlePendingUserOperationService.handleLocalUserOperationBundles(chainId, targetSigner, packedBundles);

        this.lockChainSigner.delete(keyLockSigner(chainId, targetSigner.address));

        await Promise.all([
            waitSeconds(2),
            this.userOperationService.deleteUserOperationsByIds(userOperationsToDelete.map((userOperation) => userOperation.id)),
        ]);

        this.unlockUserOperations(packedBundles.map((bundle) => bundle.userOperations).flat());
        this.unlockUserOperations(userOperationsToDelete);
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

    private packUserOperationsForSigner(chainId: number, userOperations: UserOperationDocument[], canMakeTxCount: number) {
        userOperations.sort((a, b) => {
            const r1 = a.userOpSender.localeCompare(b.userOpSender);
            if (r1 !== 0) {
                return r1;
            }

            return BigInt(a.userOpNonce.toString()) > BigInt(b.userOpNonce.toString()) ? 1 : -1;
        });

        const bundlesMap = {};
        for (let index = 0; index < userOperations.length; index++) {
            const userOperation = userOperations[index];
            if (!bundlesMap[userOperation.entryPoint]) {
                bundlesMap[userOperation.entryPoint] = [];
            }

            bundlesMap[userOperation.entryPoint].push(userOperation);
        }

        // chunk user operations into bundles by calc it's gas limit
        const bundles: { entryPoint: string; userOperations: UserOperationDocument[]; gasLimit: string }[] = [];
        const userOperationsToDelete: UserOperationDocument[] = [];
        for (const entryPoint in bundlesMap) {
            const userOperationsToPack: UserOperationDocument[] = bundlesMap[entryPoint];

            let bundle: UserOperationDocument[] = [];
            let totalGasLimit = 0n;
            for (let index = 0; index < userOperationsToPack.length; index++) {
                const userOperation = userOperationsToPack[index];
                const bundlerConfig = getBundlerChainConfig(chainId);

                // if bundle is full, push it to bundles array
                const calcedGasLimit = calcUserOpTotalGasLimit(userOperation.origin, chainId);
                if (calcedGasLimit > bundlerConfig.maxBundleGas) {
                    userOperationsToDelete.push(userOperation);
                    continue;
                }

                const newTotalGasLimit = totalGasLimit + calcedGasLimit;
                if (newTotalGasLimit > bundlerConfig.maxBundleGas || bundle.length >= bundlerConfig.maxUserOpPackCount) {
                    bundles.push({ entryPoint, userOperations: bundle, gasLimit: toBeHex(totalGasLimit) });
                    totalGasLimit = 0n;
                    bundle = [];
                }

                totalGasLimit += calcedGasLimit;
                bundle.push(userOperation);

                if (index === userOperationsToPack.length - 1) {
                    bundles.push({ entryPoint, userOperations: bundle, gasLimit: toBeHex(totalGasLimit) });
                }
            }
        }

        const unusedUserOperations = [];
        const packedBundles = [];
        for (const bundle of bundles) {
            if (canMakeTxCount <= 0) {
                unusedUserOperations.push(...bundle.userOperations);
                continue;
            }

            canMakeTxCount--;
            packedBundles.push(bundle);
        }

        return { packedBundles, unusedUserOperations, userOperationsToDelete };
    }

    private tryLockUserOperationsAndGetUnuseds(userOperations: UserOperationDocument[]): UserOperationDocument[] {
        const unusedUserOperations = [];
        for (const userOperation of userOperations) {
            if (this.lockedUserOperationHashes.has(userOperation.userOpHash)) {
                continue;
            }

            this.lockedUserOperationHashes.add(userOperation.userOpHash);
            unusedUserOperations.push(userOperation);
        }

        return unusedUserOperations;
    }

    private unlockUserOperations(userOperations: UserOperationDocument[]) {
        for (const userOperation of userOperations) {
            this.lockedUserOperationHashes.delete(userOperation.userOpHash);
        }
    }
}
