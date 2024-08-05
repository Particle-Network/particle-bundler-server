import { getAddress, Interface, toBeHex, ZeroAddress } from 'ethers';
import { JsonRPCRequestDto } from '../../dtos/json-rpc-request.dto';
import { RpcService } from '../../services/rpc.service';
import { Helper } from '../../../../common/helper';
import {
    calcPreVerificationGasV07,
    calcUserOpGasPrice,
    calcUserOpTotalGasLimit,
    getL2ExtraFee,
    getUserOpHashV07,
    isUserOpValidV07,
    packUint,
    splitOriginNonce,
    unpackAccountGasLimits,
    unpackUint,
} from '../utils';
import { cloneDeep } from 'lodash';
import { entryPointAbis, entryPointSimulateV07DeployedBytecode, entryPointSimulationV07Abi } from '../abis/entry-point-abis';
import { NEED_TO_ESTIMATE_GAS_BEFORE_SEND, SUPPORT_EIP_1559, SUPPORT_MULTCALL3 } from '../../../../common/chains';
import { IS_PRODUCTION, MULTI_CALL_3_ADDRESS } from '../../../../common/common-types';
import multiCall3Abi from '../abis/multi-call-3-abi';
import { AppException } from '../../../../common/app-exception';
import { getBundlerChainConfig } from '../../../../configs/bundler-common';
import { UserOperationDocument } from '../../schemas/user-operation.schema';
import { UserOperationService } from '../../services/user-operation.service';

const simulateEntryPointInterface = new Interface(entryPointSimulationV07Abi);

export async function sendUserOperation(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, 'Invalid params: userop must be an object');
    const userOp = body.params[0];
    const entryPoint = getAddress(body.params[1]);
    Helper.assertTrue(isUserOpValidV07(userOp), -32602, 'Invalid userOp');

    const { userOpHash, userOperationDocument } = await beforeSendUserOperation(
        rpcService,
        chainId,
        userOp,
        entryPoint,
        body.isAuth,
        body.skipCheck,
    );

    return await createOrUpdateUserOperation(rpcService.userOperationService, chainId, userOp, userOpHash, entryPoint, userOperationDocument);
}

export async function beforeSendUserOperation(
    rpcService: RpcService,
    chainId: number,
    userOp: any,
    entryPoint: string,
    isAuth: boolean,
    skipCheck: boolean,
) {
    const { verificationGasLimit, callGasLimit } = unpackAccountGasLimits(userOp.accountGasLimits);
    if (BigInt(userOp.preVerificationGas) === 0n || verificationGasLimit === 0n || callGasLimit === 0n) {
        throw new AppException(-32602, 'Invalid params: gas limits must be larger than 0');
    }

    const bundlerConfig = getBundlerChainConfig(chainId);
    const gasLimit = calcUserOpTotalGasLimit(userOp, chainId);
    Helper.assertTrue(gasLimit < bundlerConfig.maxBundleGas, -32602, 'GasLimit is too large');

    Helper.assertTrue(
        BigInt(userOp.preVerificationGas) >= BigInt(calcPreVerificationGasV07(userOp) - 1000),
        -32602,
        'preVerificationGas is too low',
    );

    const userOpHash = getUserOpHashV07(chainId, userOp, entryPoint);
    const userOpSender = getAddress(userOp.sender);
    const { nonceKey, nonceValue } = splitOriginNonce(userOp.nonce);

    let userOperationDocument: UserOperationDocument;
    if (isAuth && skipCheck) {
        userOperationDocument = await rpcService.userOperationService.getUserOperationByAddressNonce(
            chainId,
            userOpSender,
            nonceKey,
            BigInt(nonceValue).toString(),
        );
    } else {
        const [rSimulation, extraFee, signerFeeData, userOpDoc, localUserOperationsCount] = await Promise.all([
            simulateHandleOpAndGetGasCost(rpcService, chainId, userOp, entryPoint),
            getL2ExtraFee(rpcService, chainId, userOp, entryPoint),
            rpcService.chainService.getFeeDataIfCache(chainId),
            rpcService.userOperationService.getUserOperationByAddressNonce(chainId, userOpSender, nonceKey, BigInt(nonceValue).toString()),
            rpcService.userOperationService.getLocalUserOperationsCountByChainId(chainId),
            // do not care return value
            checkUserOpCanExecutedSucceed(rpcService, chainId, userOp, entryPoint),
        ]);

        Helper.assertTrue(localUserOperationsCount < bundlerConfig.userOperationLocalPoolMaxCount, -32609);

        const gasCostInContract = BigInt(rSimulation.gasCostInContract);
        const gasCostWholeTransaction = BigInt(rSimulation.gasCostWholeTransaction);
        const gasCost = NEED_TO_ESTIMATE_GAS_BEFORE_SEND.includes(chainId)
            ? gasCostWholeTransaction > gasCostInContract
                ? gasCostWholeTransaction
                : gasCostInContract
            : gasCostInContract;

        checkUserOpGasPriceIsSatisfied(chainId, userOp, gasCost, extraFee, signerFeeData);
        userOperationDocument = userOpDoc;
    }

    return {
        userOpHash,
        userOperationDocument,
    };
}

async function checkUserOpCanExecutedSucceed(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    const contractEntryPoint = rpcService.getSetCachedContract(entryPoint, entryPointAbis.v07);
    const signer = rpcService.signerService.getChainSigners(chainId)[0];

    const callTx = await contractEntryPoint.handleOps.populateTransaction([userOp], signer.address, { from: signer.address });
    const promises = [rpcService.chainService.staticCall(chainId, callTx)];
    const { nonceValue } = splitOriginNonce(userOp.nonce);

    // check account exists to replace check nonce??
    if (BigInt(nonceValue) >= 1n) {
        // check account call is success because entry point will catch the error
        promises.push(
            rpcService.chainService.estimateGas(chainId, {
                from: entryPoint,
                to: userOp.sender,
                data: userOp.callData,
            }),
        );
    }

    try {
        await Promise.all(promises);
    } catch (error) {
        if (!IS_PRODUCTION) {
            console.error(error);
        }

        throw new AppException(
            -32606,
            `Simulate user operation failed: ${
                error?.revert?.args.at(-1) ??
                (error?.info?.error?.code === 10001 ? 'Node RPC Error' : null) ??
                error?.shortMessage ??
                error?.message
            }`,
            error?.transaction,
        );
    }
}

function checkUserOpGasPriceIsSatisfied(chainId: number, userOp: any, gasCost: bigint, extraFee: string, signerFeeData?: any) {
    const signerGasPrice = calcUserOpGasPrice(signerFeeData, signerFeeData.baseFee);

    const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint(userOp.gasFees);
    const userOpGasPrice = calcUserOpGasPrice({ maxPriorityFeePerGas, maxFeePerGas }, signerFeeData.baseFee);

    const signerPaid = (gasCost + 1000n) * BigInt(signerGasPrice);

    // userOpPaid = gasCost * userOpGasPrice
    // signerPaid = gasCost * signerGasPrice
    // userOpPaid - signerPaid > extraFee (L1 Fee)

    const userOpPaid = gasCost * BigInt(userOpGasPrice);

    // userOpPaid >= signerPaid + extraFee
    const diff = userOpPaid - signerPaid - BigInt(extraFee);
    if (diff >= 0n) {
        return;
    }

    // ((diff * 10000) / (signerPaid + extraFee)
    const toleranceGap = (diff * 10000n) / (signerPaid + BigInt(extraFee));
    // Fault tolerance 20%
    if (toleranceGap > -2000n) {
        return;
    }

    throw new AppException(
        -32602,
        `maxFeePerGas or maxPriorityFeePerGas is too low: ${JSON.stringify({
            signerGasPrice,
            signerPaid: (signerPaid + BigInt(extraFee)).toString(),
            userOpGasPrice,
            userOpPaid: (gasCost * BigInt(userOpGasPrice)).toString(),
            extraFee: BigInt(extraFee).toString(),
            baseFee: signerFeeData.baseFee,
        })}`,
    );
}

export async function createOrUpdateUserOperation(
    userOperationService: UserOperationService,
    chainId: number,
    userOp: any,
    userOpHash: string,
    entryPoint: string,
    userOperationDocument?: UserOperationDocument,
) {
    const newUserOpDoc = await userOperationService.createOrUpdateUserOperation(chainId, userOp, userOpHash, entryPoint, userOperationDocument);

    // temp disable event emitter
    // ProcessEventEmitter.sendMessages(PROCESS_EVENT_TYPE.CREATE_USER_OPERATION, newUserOpDoc.toJSON());

    return userOpHash;
}

export async function simulateHandleOpAndGetGasCost(
    rpcService: RpcService,
    chainId: number,
    userOp: any,
    entryPoint: string,
    stateOverride?: any,
) {
    userOp = cloneDeep(userOp);
    userOp.gasFees = packUint(1, 1);

    const tx = {
        to: entryPoint,
        data: simulateEntryPointInterface.encodeFunctionData('simulateHandleOp', [userOp, ZeroAddress, '0x']),
    };

    stateOverride = stateOverride ?? {};
    stateOverride[entryPoint] = {
        code: entryPointSimulateV07DeployedBytecode,
    };

    let [resultCallSimulateHandleOp, gasCostWholeTransaction] = await Promise.all([
        rpcService.chainService.staticCall(chainId, tx, false, stateOverride),
        tryGetGasCostWholeTransaction(chainId, rpcService, entryPoint, userOp, stateOverride),
    ]);

    const simulateHandleOpInfo = simulateEntryPointInterface.decodeFunctionResult('simulateHandleOp', resultCallSimulateHandleOp.result)[0];

    // TODO mergeValidationDataValues validAfter validUntil
    const verificationGasLimit = Number(BigInt(simulateHandleOpInfo.preOpGas));
    const gasCostInContract = BigInt(simulateHandleOpInfo.paid);

    return { gasCostInContract, gasCostWholeTransaction, verificationGasLimit };
}

async function tryGetGasCostWholeTransaction(chainId: number, rpcService: RpcService, entryPoint: string, userOp: any, stateOverride?: any) {
    if (!SUPPORT_MULTCALL3.includes(chainId)) {
        return '0x00';
    }

    const multiCallContract = rpcService.getSetCachedContract(MULTI_CALL_3_ADDRESS, multiCall3Abi);
    const signer = rpcService.signerService.getChainSigners(chainId)[0];
    const toEstimatedTx = await multiCallContract.tryAggregate.populateTransaction(false, [
        {
            target: entryPoint,
            callData: simulateEntryPointInterface.encodeFunctionData('simulateHandleOp', [userOp, ZeroAddress, '0x']),
        },
    ]);

    toEstimatedTx.from = signer.address;
    return toBeHex(await rpcService.chainService.estimateGas(chainId, toEstimatedTx, stateOverride));
}
