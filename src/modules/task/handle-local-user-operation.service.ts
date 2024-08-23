import { Injectable, Logger } from '@nestjs/common';
import { IBundle, IPackedBundle, IS_DEVELOPMENT, SignerWithPendingTxCount, keyLockSigner } from '../../common/common-types';
import { Helper } from '../../common/helper';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { Cron } from '@nestjs/schedule';
import { getBundlerChainConfig } from '../../configs/bundler-common';
import { toBeHex } from 'ethers';
import { LarkService } from '../common/services/lark.service';
import { calcUserOpTotalGasLimit, canRunCron, getSupportChainIdCurrentProcess, waitSeconds } from '../rpc/aa/utils';
import { HandlePendingUserOperationService } from './handle-pending-user-operation.service';
import { SignerService } from '../rpc/services/signer.service';
import { UserOperationEntity } from '../rpc/entities/user-operation.entity';

@Injectable()
export class HandleLocalUserOperationService {
    public readonly lockedUserOperationHashes: Set<number> = new Set();
    public readonly lockChainSigner: Set<string> = new Set();

    public constructor(
        private readonly signerService: SignerService,
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
            let userOperations = await this.userOperationService.getLocalUserOperations(getSupportChainIdCurrentProcess(), 1000);
            userOperations = this.tryLockUserOperationsAndGetUnuseds(userOperations);
            if (userOperations.length <= 0) {
                return;
            }

            const userOperationsByChainId = this.groupByUserOperationsByChainId(userOperations);
            const chainIds = Object.keys(userOperationsByChainId);
            for (const chainId of chainIds) {
                // warning need to delete unused cache
                this.assignSignerAndSealUserOps(Number(chainId), userOperationsByChainId[chainId]);
            }
        } catch (error) {
            Logger.error(`[Seal User Ops Error]`, error);
            this.larkService.sendMessage(`[Seal User Ops Error]: ${Helper.converErrorToString(error)}`);
        }
    }

    private async assignSignerAndSealUserOps(chainId: number, userOperationEntities: UserOperationEntity[]) {
        const signersWithPendingTxCount: SignerWithPendingTxCount[] = await this.pickAvailableSigners(chainId);
        if (signersWithPendingTxCount.length <= 0) {
            this.larkService.sendMessage(`No signer available on ${chainId}`);
            this.unlockUserOperations(userOperationEntities);
            return;
        }

        const { packedBundles, unusedUserOperations, userOperationsToDelete } = this.packUserOperationsForSigner(
            chainId,
            userOperationEntities,
            signersWithPendingTxCount,
        );

        this.unlockUserOperations(unusedUserOperations);

        await Promise.all(
            signersWithPendingTxCount.map(async (signerWithPendingTxCount) => {
                const packedBundle = packedBundles.find((packedBundle) => packedBundle.address === signerWithPendingTxCount.signer.address);
                if (!!packedBundle) {
                    await this.handlePendingUserOperationService.handleLocalUserOperationBundles(
                        chainId,
                        packedBundle.signer,
                        packedBundle.bundles,
                    );
                }

                const signerAddress = signerWithPendingTxCount.signer.address;
                this.lockChainSigner.delete(keyLockSigner(chainId, signerWithPendingTxCount.signer.address));
                Logger.debug(`[Pick Chain Signer] On Chain ${chainId} ${signerAddress} Unlocked`);
            }),
        );

        await Promise.all([
            waitSeconds(2),
            this.userOperationService.deleteUserOperationsByIds(userOperationsToDelete.map((userOperationEntity) => userOperationEntity.id)),
        ]);

        this.unlockUserOperations(
            packedBundles.map((packedBundle) => packedBundle.bundles.map((bundle) => bundle.userOperations).flat()).flat(),
        );
        this.unlockUserOperations(userOperationsToDelete);
    }

    public async pickAvailableSigners(chainId: number): Promise<SignerWithPendingTxCount[]> {
        let targetSignerWithPendingTxCount: SignerWithPendingTxCount[] = [];
        const bundlerConfig = getBundlerChainConfig(chainId);
        const randomValidSigners = this.signerService.getRandomValidSigners(chainId);
        const signerWithPendingTxCount: SignerWithPendingTxCount[] = await Promise.all(
            randomValidSigners.map(async (signer) => {
                const pendingTxCount = await this.signerService.getChainSignerPendingTxCount(chainId, signer.address);
                return { signer, availableTxCount: bundlerConfig.pendingTransactionSignerHandleLimit - pendingTxCount };
            }),
        );

        signerWithPendingTxCount.sort((a, b) => b.availableTxCount - a.availableTxCount);
        let takeOnce = IS_DEVELOPMENT
            ? randomValidSigners.length
            : Math.min(Math.ceil(randomValidSigners.length / 5), bundlerConfig.maxUserOpPackCount);

        for (let index = 0; index < signerWithPendingTxCount.length; index++) {
            const signer = signerWithPendingTxCount[index].signer;
            if (!this.lockChainSigner.has(keyLockSigner(chainId, signer.address))) {
                if (signerWithPendingTxCount[index].availableTxCount > 0) {
                    this.lockChainSigner.add(keyLockSigner(chainId, signer.address));

                    const availableTxCount = signerWithPendingTxCount[index].availableTxCount;
                    Logger.debug(`[Pick Chain Signer] On Chain ${chainId} ${signer.address} Locked | AvailableTxCount: ${availableTxCount}`);

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

    public packUserOperationsForSigner(
        chainId: number,
        userOperationEntities: UserOperationEntity[],
        signersWithPendingTxCount: SignerWithPendingTxCount[],
    ) {
        userOperationEntities.sort((a, b) => {
            const r1 = a.userOpSender.localeCompare(b.userOpSender);
            if (r1 !== 0) {
                return r1;
            }

            if (BigInt(a.userOpNonceKey) !== BigInt(b.userOpNonceKey)) {
                return BigInt(a.userOpNonceKey) > BigInt(b.userOpNonceKey) ? 1 : -1;
            }

            return BigInt(a.userOpNonce) > BigInt(b.userOpNonce) ? 1 : -1;
        });

        const bundlesMap = {};
        for (let index = 0; index < userOperationEntities.length; index++) {
            const userOperationEntity = userOperationEntities[index];
            if (!bundlesMap[userOperationEntity.entryPoint]) {
                bundlesMap[userOperationEntity.entryPoint] = [];
            }

            bundlesMap[userOperationEntity.entryPoint].push(userOperationEntity);
        }

        // chunk user operations into bundles by calc it's gas limit
        const bundles: IBundle[] = [];
        const userOperationEntitiesToDelete: UserOperationEntity[] = [];
        for (const entryPoint in bundlesMap) {
            const userOperationsToPack: UserOperationEntity[] = bundlesMap[entryPoint];

            let bundle: UserOperationEntity[] = [];
            let totalGasLimit = 0n;
            for (let index = 0; index < userOperationsToPack.length; index++) {
                const userOperationEntity = userOperationsToPack[index];
                const bundlerConfig = getBundlerChainConfig(chainId);

                const allUserOperations = [userOperationEntity].concat(userOperationEntity.associatedUserOps ?? []);
                let calcedGasLimit = 0n;
                for (const userOperation of allUserOperations) {
                    calcedGasLimit += calcUserOpTotalGasLimit(userOperation.origin, chainId);
                }

                // if bundle is full, push it to bundles array
                if (calcedGasLimit > bundlerConfig.maxBundleGas) {
                    userOperationEntitiesToDelete.push(userOperationEntity);
                    continue;
                }

                const newTotalGasLimit = totalGasLimit + calcedGasLimit;
                if (newTotalGasLimit > bundlerConfig.maxBundleGas || bundle.length >= bundlerConfig.maxUserOpPackCount) {
                    bundles.push({ entryPoint, userOperations: bundle, gasLimit: toBeHex(totalGasLimit) });
                    totalGasLimit = 0n;
                    bundle = [];
                }

                totalGasLimit += calcedGasLimit;
                bundle.push(userOperationEntity);

                if (index === userOperationsToPack.length - 1) {
                    bundles.push({ entryPoint, userOperations: bundle, gasLimit: toBeHex(totalGasLimit) });
                }
            }
        }

        const { packedBundles, unusedUserOperations } = this.packBundles(signersWithPendingTxCount, bundles);

        return { packedBundles, unusedUserOperations, userOperationsToDelete: userOperationEntitiesToDelete };
    }

    private packBundles(signersWithPendingTxCount: SignerWithPendingTxCount[], bundles: IBundle[]) {
        const unusedUserOperations: UserOperationEntity[] = [];
        const packedBundles: IPackedBundle[] = [];

        while (true) {
            let packed: boolean = false;
            for (const signerWithPendingTxCount of signersWithPendingTxCount) {
                if (signerWithPendingTxCount.availableTxCount > 0) {
                    const bundle = bundles.shift();
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
                    signerWithPendingTxCount.availableTxCount--;
                }
            }

            // packed means no signer is available, so the rest of the bundles will be unused
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

    public tryLockUserOperationsAndGetUnuseds(userOperations: UserOperationEntity[]): UserOperationEntity[] {
        const unusedUserOperations = [];
        for (const userOperation of userOperations) {
            if (this.lockedUserOperationHashes.has(userOperation.id)) {
                continue;
            }

            this.lockedUserOperationHashes.add(userOperation.id);
            unusedUserOperations.push(userOperation);
        }

        return unusedUserOperations;
    }

    public unlockUserOperations(userOperationEntities: UserOperationEntity[]) {
        for (const userOperationEntity of userOperationEntities) {
            this.lockedUserOperationHashes.delete(userOperationEntity.id);
        }
    }

    public groupByUserOperationsByChainId(userOperations: UserOperationEntity[]) {
        const userOperationsByChainId: { [chainId: number]: UserOperationEntity[] } = {};
        for (const userOperation of userOperations) {
            if (!userOperationsByChainId[userOperation.chainId]) {
                userOperationsByChainId[userOperation.chainId] = [];
            }

            userOperationsByChainId[userOperation.chainId].push(userOperation);
        }

        return userOperationsByChainId;
    }
}
