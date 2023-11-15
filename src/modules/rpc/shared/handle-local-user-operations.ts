import { Wallet, JsonRpcProvider } from 'ethers';
import { AAService } from '../services/aa.service';
import { Helper } from '../../../common/helper';
import { RpcService } from '../services/rpc.service';
import { UserOperationDocument } from '../schemas/user-operation.schema';
import { GAS_FEE_LEVEL, keyLockSigner } from '../../../common/common-types';
import { calcUserOpTotalGasLimit, getFeeDataFromParticle } from '../aa/utils';
import { createBundleTransaction } from './handle-local-transactions';
import { Connection } from 'mongoose';
import Lock from '../../../common/global-lock';
import { BigNumber } from '../../../common/bignumber';
import { Alert } from '../../../common/alert';
import { getBundlerConfig } from '../../../configs/bundler-common';
import { Logger } from '@nestjs/common';

export async function handleLocalUserOperations(
    chainId: number,
    rpcService: RpcService,
    aaService: AAService,
    signer: Wallet,
    userOperations: UserOperationDocument[],
    mongodbConnection: Connection,
) {
    try {
        if (userOperations.length <= 0) {
            return;
        }

        Logger.log(`Start Handling ${userOperations.length} user operations on chain ${chainId}`);

        const provider = rpcService.getJsonRpcProvider(chainId);
        await sealUserOps(chainId, provider, signer, userOperations, mongodbConnection, rpcService, aaService);
    } catch (error) {
        Logger.error(`Handle Local Ops Error On Chain ${chainId}`, error);
        Alert.sendMessage(`Handle Local Ops Error On Chain ${chainId}: ${Helper.converErrorToString(error)}`);
    }

    Logger.log(`handleLocalUserOperations Finish release on chain ${chainId} with ${signer.address}`);
    Lock.release(keyLockSigner(chainId, signer.address));
}

async function sealUserOps(
    chainId: number,
    provider: JsonRpcProvider,
    signer: Wallet,
    userOperations: UserOperationDocument[],
    mongodbConnection: Connection,
    rpcService: RpcService,
    aaService: AAService,
) {
    if (userOperations.length === 0) {
        return;
    }

    Logger.log(`${chainId}: ${userOperations.length} user operations`);

    const bundlesMap = {};
    for (let index = 0; index < userOperations.length; index++) {
        const userOperation = userOperations[index];
        if (!bundlesMap[userOperation.entryPoint]) {
            bundlesMap[userOperation.entryPoint] = [];
        }

        bundlesMap[userOperation.entryPoint].push(userOperation);
    }

    // chunk user operations into bundles by calc it's gas limit
    let bundles = [];
    for (const entryPoint in bundlesMap) {
        const userOperationsToPack: UserOperationDocument[] = bundlesMap[entryPoint];

        let bundle = [];
        let totalGasLimit: BigNumber = BigNumber.from(0);
        for (let index = 0; index < userOperationsToPack.length; index++) {
            const userOperation = userOperationsToPack[index];

            // if bundle is full, push it to bundles array
            const calcedGasLimit = calcUserOpTotalGasLimit(userOperation.origin);
            const newTotalGasLimit = totalGasLimit.add(calcedGasLimit);
            const bundlerConfig = getBundlerConfig(chainId);
            if (newTotalGasLimit.gt(bundlerConfig.MAX_BUNDLE_GAS)) {
                bundles.push({ userOperations: bundle, gasLimit: totalGasLimit.toHexString() });
                bundle = [];
                totalGasLimit = BigNumber.from(0);
            }

            totalGasLimit = totalGasLimit.add(calcedGasLimit);
            bundle.push(userOperation);

            if (index === userOperationsToPack.length - 1) {
                bundles.push({ userOperations: bundle, gasLimit: totalGasLimit.toHexString() });
            }
        }
    }

    Logger.log(`sealUserOps Finish, ${chainId}`, bundles);

    let latestTransaction: any, pendingNonce: any, feeData: any;
    try {
        [latestTransaction, pendingNonce, feeData] = await Promise.all([
            aaService.transactionService.getLatestTransaction(chainId, signer.address),
            provider.getTransactionCount(signer.address, 'pending'),
            getFeeDataFromParticle(chainId, GAS_FEE_LEVEL.MEDIUM),
        ]);
    } catch (error) {
        Logger.error(`fetch provider error on chain ${chainId}`, error);
        Alert.sendMessage(`Fetch Provider Error On Chain ${chainId}: ${Helper.converErrorToString(error)}`);

        setTimeout(() => {
            // retry after 1s
            sealUserOps(chainId, provider, signer, userOperations, mongodbConnection, rpcService, aaService);
        }, 1000);
        return;
    }

    let latestNonce = (latestTransaction ? latestTransaction.nonce : -1) + 1;
    let finalizedNonce = latestNonce > pendingNonce ? latestNonce : pendingNonce;

    let newFeeData: any = feeData;
    console.log('latestNonce', latestTransaction?.nonce, latestNonce, finalizedNonce);
    console.log('newFeeData', newFeeData);

    const promises = [];
    for (const bundle of bundles) {
        promises.push(
            createBundleTransaction(
                chainId,
                bundle.userOperations[0].entryPoint,
                mongodbConnection,
                provider,
                aaService,
                bundle.userOperations,
                bundle.gasLimit,
                signer,
                finalizedNonce,
                newFeeData,
            ),
        );

        finalizedNonce++;
    }

    await Promise.all(promises);
}
