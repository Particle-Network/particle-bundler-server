import { Wallet, JsonRpcProvider } from 'ethers';
import { AAService } from '../services/aa.service';
import { Helper } from '../../../common/helper';
import { RpcService } from '../services/rpc.service';
import { UserOperationDocument } from '../schemas/user-operation.schema';
import { calcUserOpTotalGasLimit } from '../aa/utils';
import { createBundleTransaction } from './handle-local-transactions';
import { Connection } from 'mongoose';
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
        Logger.log(`Start Handling ${userOperations.length} user operations on chain ${chainId}`);

        const provider = rpcService.getJsonRpcProvider(chainId);
        await sealUserOps(chainId, provider, signer, userOperations, mongodbConnection, rpcService, aaService);
    } catch (error) {
        Logger.error(`Handle Local Ops Error On Chain ${chainId}`, error);
        Alert.sendMessage(`Handle Local Ops Error On Chain ${chainId}: ${Helper.converErrorToString(error)}`);
    }

    Logger.log(`handleLocalUserOperations Finish release on chain ${chainId} with ${signer.address}`);
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

    Logger.log(`SealUserOps On Chain ${chainId}: ${userOperations.length} user operations`);

    // Sort user operations by sender and nonce
    userOperations.sort((a, b) => {
        const r1 = a.userOpSender.localeCompare(b.userOpSender);
        if (r1 !== 0) {
            return r1;
        }

        return BigNumber.from(a.userOpNonce).gt(BigNumber.from(b.userOpNonce)) ? 1 : -1;
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

    Logger.log(`SealUserOps Finish, ${chainId}`, bundles);

    let latestTransaction: any, latestNonce: any, feeData: any;
    try {
        [latestTransaction, latestNonce, feeData] = await Promise.all([
            aaService.transactionService.getLatestTransaction(chainId, signer.address),
            aaService.getTransactionCountLocalCache(provider, chainId, signer.address),
            aaService.getFeeData(chainId),
        ]);
    } catch (error) {
        const userOperationIds = userOperations.map((u) => u.id);
        Logger.error(`fetch provider error on chain ${chainId}; UserOpIds ${JSON.stringify(userOperationIds)}`, error);
        Alert.sendMessage(
            `Fetch Provider Error On Chain ${chainId}; UserOpIds ${JSON.stringify(userOperationIds)}; ${Helper.converErrorToString(error)}`,
        );

        // retry after 1s
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await sealUserOps(chainId, provider, signer, userOperations, mongodbConnection, rpcService, aaService);
        return;
    }

    let localLatestNonce = (latestTransaction ? latestTransaction.nonce : -1) + 1;
    let finalizedNonce = localLatestNonce > latestNonce ? localLatestNonce : latestNonce;

    let newFeeData: any = feeData;
    console.log('latestNonce', latestTransaction?.nonce, localLatestNonce, finalizedNonce);
    console.log('newFeeData', newFeeData);

    for (const bundle of bundles) {
        await createBundleTransaction(
            chainId,
            bundle.userOperations[0].entryPoint,
            mongodbConnection,
            provider,
            rpcService,
            bundle.userOperations,
            bundle.gasLimit,
            signer,
            finalizedNonce,
            newFeeData,
        );

        finalizedNonce++;
    }
}
