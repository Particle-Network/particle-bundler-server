import { Injectable } from '@nestjs/common';
import { AAService } from '../rpc/services/aa.service';
import { TransactionService } from '../rpc/services/transaction.service';
import { IBundle, IPackedBundle, IS_PRODUCTION, SignerWithPendingTxCount, keyLockSigner } from '../../common/common-types';
import { Helper } from '../../common/helper';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { Cron } from '@nestjs/schedule';
import { getBundlerChainConfig } from '../../configs/bundler-common';
import { Wallet, toBeHex } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { LarkService } from '../common/services/lark.service';
import { calcUserOpTotalGasLimit, canRunCron, waitSeconds } from '../rpc/aa/utils';
import { HandlePendingUserOperationService } from './handle-pending-user-operation.service';
import { SignerService } from '../rpc/services/signer.service';

@Injectable()
export class HandleLocalUserOperationService {
    private readonly lockedUserOperationHashes: Set<string> = new Set();
    private readonly lockChainSigner: Set<string> = new Set();

    public constructor(
        private readonly aaService: AAService,
        private readonly signerService: SignerService,
        private readonly transactionService: TransactionService,
        private readonly larkService: LarkService,
        private readonly userOperationService: UserOperationService,
        private readonly handlePendingUserOperationService: HandlePendingUserOperationService,
    ) {}

    @Cron('* * * * * *')
    public async sealUserOps() {
        if (!canRunCron()) {
            return;
        }

        try {
            let userOperations = await this.userOperationService.getLocalUserOperations(1000);
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
        const signersWithPendingTxCount: SignerWithPendingTxCount[] = await this.waitForASigners(chainId);
        if (signersWithPendingTxCount.length <= 0) {
            this.larkService.sendMessage(`No signer available on ${chainId}`);
            this.unlockUserOperations(userOperations);
            return;
        }

        const { packedBundles, unusedUserOperations, userOperationsToDelete } = this.packUserOperationsForSigner(
            chainId,
            userOperations,
            signersWithPendingTxCount,
        );

        this.unlockUserOperations(unusedUserOperations);

        await Promise.all(
            packedBundles.map(async (packedBundle) => {
                await this.handlePendingUserOperationService.handleLocalUserOperationBundles(chainId, packedBundle.signer, packedBundle.bundles);
                this.lockChainSigner.delete(keyLockSigner(chainId, packedBundle.address));
            }),
        );

        await Promise.all([
            waitSeconds(2),
            this.userOperationService.deleteUserOperationsByIds(userOperationsToDelete.map((userOperation) => userOperation.id)),
        ]);

        this.unlockUserOperations(
            packedBundles.map((packedBundle) => packedBundle.bundles.map((bundle) => bundle.userOperations).flat()).flat(),
        );
        this.unlockUserOperations(userOperationsToDelete);
    }

    private async waitForASigners(chainId: number): Promise<SignerWithPendingTxCount[]> {
        let targetSignerWithPendingTxCount: SignerWithPendingTxCount[] = [];
        const bundlerConfig = getBundlerChainConfig(chainId);
        const randomValidSigners = this.signerService.getRandomValidSigners(chainId);
        const signerWithPendingTxCount: SignerWithPendingTxCount[] = await Promise.all(
            randomValidSigners.map(async (signer) => {
                const pendingTxCount = await this.signerService.getChainSignerPendingTxCount(chainId, signer.address);
                return { signer, pendingTxCount };
            }),
        );

        signerWithPendingTxCount.sort((a, b) => a.pendingTxCount - b.pendingTxCount);
        let takeOnce = Math.ceil(randomValidSigners.length / 5);

        for (let index = 0; index < signerWithPendingTxCount.length; index++) {
            const signer = signerWithPendingTxCount[index].signer;
            if (!this.lockChainSigner.has(keyLockSigner(chainId, signer.address))) {
                this.lockChainSigner.add(keyLockSigner(chainId, signer.address));

                if (signerWithPendingTxCount[index].pendingTxCount < bundlerConfig.pendingTransactionSignerHandleLimit) {
                    targetSignerWithPendingTxCount.push(signerWithPendingTxCount[index]);
                    takeOnce--;
                }

                if (takeOnce <= 0) {
                    break;
                }
            }
        }

        return targetSignerWithPendingTxCount;
    }

    private packUserOperationsForSigner(
        chainId: number,
        userOperations: UserOperationDocument[],
        signersWithPendingTxCount: SignerWithPendingTxCount[],
    ) {
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
        const bundles: IBundle[] = [];
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

        const { packedBundles, unusedUserOperations } = this.packBundles(signersWithPendingTxCount, bundles);

        return { packedBundles, unusedUserOperations, userOperationsToDelete };
    }

    private packBundles(signersWithPendingTxCount: SignerWithPendingTxCount[], bundles: IBundle[]) {
        const unusedUserOperations: UserOperationDocument[] = [];
        const packedBundles: IPackedBundle[] = [];

        while (true) {
            let packed: boolean = false;
            for (const signerWithPendingTxCount of signersWithPendingTxCount) {
                if (signerWithPendingTxCount.pendingTxCount > 0) {
                    const bundle = bundles.pop();
                    if (!bundle) {
                        return { packedBundles, unusedUserOperations };
                    }

                    const targetPackedBundles = packedBundles.find((p) => p.address === signerWithPendingTxCount.signer.address);
                    if (!targetPackedBundles) {
                        packedBundles.push({
                            signer: signerWithPendingTxCount.signer,
                            address: signerWithPendingTxCount.signer.address,
                            bundles: [bundle],
                        });
                    } else {
                        targetPackedBundles.bundles.push(bundle);
                    }

                    packed = true;
                    signerWithPendingTxCount.pendingTxCount--;
                }
            }

            if (!packed) {
                for (const bundle of bundles) {
                    unusedUserOperations.push(...bundle.userOperations);
                }

                return { packedBundles, unusedUserOperations };
            }

            if (bundles.length <= 0) {
                return { packedBundles, unusedUserOperations };
            }
        }
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
