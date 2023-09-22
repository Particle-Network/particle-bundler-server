import { Wallet, JsonRpcProvider } from 'ethers';
import { AAService } from '../services/aa.service';
import { Helper } from '../../../common/helper';
import { RpcService } from '../services/rpc.service';
import { UserOperationDocument } from '../schemas/user-operation.schema';
import { keyLockSigner } from '../../../common/common-types';
import { calcUserOpTotalGasLimit } from '../aa/utils';
import { createBundleTransaction } from './handle-local-transactions';
import { Connection } from 'mongoose';
import Lock from '../../../common/global-lock';
import { MINIMUM_GAS_FEE } from '../../../configs/bundler-config';
import { BigNumber } from '../../../common/bignumber';
import { BUNDLER_CONFIG } from '../../../configs/bundler-config';

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

        console.log(`${chainId}: ${userOperations.length} user operations`);

        const provider = rpcService.getJsonRpcProvider(chainId);
        await sealUserOps(chainId, provider, signer, userOperations, mongodbConnection, rpcService, aaService);
    } catch (error) {
        console.error(error);
        aaService.http2Service.sendLarkMessage(`Handle Local Ops Error: ${Helper.converErrorToString(error)}`);
    }

    console.log('handleLocalUserOperations Finish release', chainId, signer.address);
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

    console.log(`${chainId}: ${userOperations.length} user operations`);

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
            if (newTotalGasLimit.gt(BUNDLER_CONFIG.maxBundleGas)) {
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

    console.log(`sealUserOps Finish, ${chainId}`, bundles);

    let latestTransaction: any, pendingNonce: any, feeData: any;
    try {
        [latestTransaction, pendingNonce, feeData] = await Promise.all([
            aaService.transactionService.getLatestTransaction(chainId, signer.address),
            provider.getTransactionCount(signer.address, 'pending'),
            rpcService.getFeeData(chainId),
        ]);
    } catch (error) {
        console.error('fetch provider error', error);
        rpcService.http2Service.sendLarkMessage(`Fetch Provider Error: ${Helper.converErrorToString(error)}`);

        setTimeout(() => {
            // retry after 1s
            sealUserOps(chainId, provider, signer, userOperations, mongodbConnection, rpcService, aaService);
        }, 1000);
        return;
    }

    let latestNonce = (latestTransaction ? latestTransaction.nonce : -1) + 1;
    let finalizedNonce = latestNonce > pendingNonce ? latestNonce : pendingNonce;

    let newFeeData: any = feeData;
    if (BigNumber.from(feeData.gasPrice ?? 0).lt(MINIMUM_GAS_FEE?.[chainId]?.gasPrice ?? 0)) {
        newFeeData.gasPrice = BigNumber.from(MINIMUM_GAS_FEE?.[chainId]?.gasPrice).toBigInt();
    }

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
