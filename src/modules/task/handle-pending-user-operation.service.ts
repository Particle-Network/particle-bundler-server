import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Wallet, toBeHex } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { RpcService } from '../rpc/services/rpc.service';
import { AppException } from '../../common/app-exception';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { IS_PRODUCTION } from '../../common/common-types';
import { getBundlerChainConfig } from '../../configs/bundler-common';
import { calcUserOpTotalGasLimit, waitSeconds } from '../rpc/aa/utils';
import { EVM_CHAIN_ID } from '../../common/chains';
import { AAService } from '../rpc/services/aa.service';

@Injectable()
export class HandlePendingUserOperationService {
    public constructor(
        @InjectConnection() private readonly connection: Connection,
        private readonly rpcService: RpcService,
        private readonly larkService: LarkService,
        private readonly aaService: AAService,
    ) {}

    public async handleLocalUserOperations(chainId: number, signer: Wallet, userOperations: UserOperationDocument[]) {
        try {
            console.log(`Start Handling ${userOperations.length} user operations on chain ${chainId}`);

            await this.sealLocalUserOps(chainId, signer, userOperations);
        } catch (error) {
            if (!(error instanceof AppException)) {
                if (!IS_PRODUCTION) {
                    console.error(`Handle Local Ops Error On Chain ${chainId}`, error);
                }

                this.larkService.sendMessage(`Handle Local Ops Error On Chain ${chainId}: ${Helper.converErrorToString(error)}`);
            }
        }

        console.log(`handleLocalUserOperations Finish release on chain ${chainId} with ${signer.address}`);
    }

    private async sealLocalUserOps(chainId: number, signer: Wallet, userOperations: UserOperationDocument[]) {
        if (userOperations.length === 0) {
            return;
        }

        const provider = this.rpcService.getJsonRpcProvider(chainId);
        console.log(`SealUserOps On Chain ${chainId}: ${userOperations.length} user operations`);

        // Sort user operations by sender and nonce
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
        const bundles: { userOperations: UserOperationDocument[]; gasLimit: string }[] = [];
        const userOperationsToDelete: UserOperationDocument[] = [];
        for (const entryPoint in bundlesMap) {
            const userOperationsToPack: UserOperationDocument[] = bundlesMap[entryPoint];

            let bundle: UserOperationDocument[] = [];
            let totalGasLimit = 0n;
            for (let index = 0; index < userOperationsToPack.length; index++) {
                const userOperation = userOperationsToPack[index];
                const bundlerConfig = getBundlerChainConfig(chainId);

                // if bundle is full, push it to bundles array
                const calcedGasLimit = calcUserOpTotalGasLimit(userOperation.origin);
                if (calcedGasLimit > bundlerConfig.maxBundleGas) {
                    userOperationsToDelete.push(userOperation);
                    console.log('delete userOperation', userOperation.chainId, userOperation.userOpHash, calcedGasLimit.toString());
                    continue;
                }

                const newTotalGasLimit = totalGasLimit + calcedGasLimit;
                if (newTotalGasLimit > bundlerConfig.maxBundleGas || bundle.length >= bundlerConfig.maxUserOpPackCount) {
                    bundles.push({ userOperations: bundle, gasLimit: toBeHex(totalGasLimit) });
                    totalGasLimit = 0n;
                    bundle = [];
                }

                totalGasLimit += calcedGasLimit;
                bundle.push(userOperation);

                if (index === userOperationsToPack.length - 1) {
                    bundles.push({ userOperations: bundle, gasLimit: toBeHex(totalGasLimit) });
                }
            }
        }

        console.log(`SealUserOps Finish, ${chainId}`, bundles.length);

        let latestTransaction: any, latestNonce: any, feeData: any;
        try {
            [latestTransaction, latestNonce, feeData] = await Promise.all([
                this.aaService.transactionService.getLatestTransaction(chainId, signer.address),
                this.aaService.getTransactionCountWithCache(provider, chainId, signer.address),
                this.aaService.getFeeData(chainId),
            ]);
        } catch (error) {
            // should be network error, can try again

            const userOperationIds = userOperations.map((u) => `${u.chainId}-${u.userOpHash}`);
            if (!IS_PRODUCTION) {
                console.error(`fetch provider error on chain ${chainId}; UserOpIds ${JSON.stringify(userOperationIds)}`, error);
            }
            this.larkService.sendMessage(
                `Fetch Provider Error On Chain ${chainId}; UserOpIds ${JSON.stringify(userOperationIds)}; ${Helper.converErrorToString(error)}`,
            );

            // retry after 1s
            await waitSeconds(1);
            await this.sealLocalUserOps(chainId, signer, userOperations);
            return;
        }

        const localLatestNonce = (latestTransaction ? latestTransaction.nonce : -1) + 1;
        let finalizedNonce = localLatestNonce > latestNonce ? localLatestNonce : latestNonce;

        const newFeeData: any = feeData;
        for (const bundle of bundles) {
            await createBundleTransaction(
                chainId,
                bundle.userOperations[0].entryPoint,
                mongodbConnection,
                provider,
                rpcService,
                listenerService,
                bundle.userOperations,
                bundle.gasLimit,
                signer,
                finalizedNonce,
                newFeeData,
            );

            finalizedNonce++;
        }
    }
}
