import { Contract, ZeroAddress, getAddress, isAddress, toBeHex } from 'ethers';
import { JsonRPCRequestDto } from '../../dtos/json-rpc-request.dto';
import { RpcService } from '../../services/rpc.service';
import { Helper } from '../../../../common/helper';
import { IS_PRODUCTION, MULTI_CALL_3_ADDRESS } from '../../../../common/common-types';
import { AppException } from '../../../../common/app-exception';
import {
    calcUserOpGasPrice,
    calcUserOpTotalGasLimit,
    getL2ExtraFee,
    getUserOpHashV06,
    isUserOpValidV06,
    parsePaymasterAndDataAndGetExpiredAt,
    splitOriginNonce,
} from '../utils';
import { FORBIDDEN_PAYMASTER, PAYMASTER_CHECK, getBundlerChainConfig } from '../../../../configs/bundler-common';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import { cloneDeep } from 'lodash';
import MultiCall3Abi from '../abis/multi-call-3-abi';
import { EVM_CHAIN_ID, NEED_TO_ESTIMATE_GAS_BEFORE_SEND, SUPPORT_EIP_1559, SUPPORT_MULTCALL3 } from '../../../../common/chains';
import { UserOperationService } from '../../services/user-operation.service';
import { entryPointAbis } from '../abis/entry-point-abis';
import { UserOperationEntity } from '../../entities/user-operation.entity';
import { tryPreExecuteUserOp } from '../pre-execute-user-op';

export async function sendUserOperation(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, 'Invalid params: userop must be an object');
    const userOp = body.params[0];
    const entryPoint = getAddress(body.params[1]);
    Helper.assertTrue(isUserOpValidV06(userOp), -32602, 'Invalid userOp');

    const { userOpHash, userOperationEntity } = await beforeSendUserOperation(
        rpcService,
        chainId,
        userOp,
        entryPoint,
        body.isAuth,
        body.skipVerification,
    );

    return await createOrUpdateUserOperation(rpcService.userOperationService, chainId, userOp, userOpHash, entryPoint, userOperationEntity);
}

export async function beforeSendUserOperation(
    rpcService: RpcService,
    chainId: number,
    userOp: any,
    entryPoint: string,
    isAuth: boolean,
    skipVerification: boolean,
) {
    Helper.assertTrue(BigInt(userOp.verificationGasLimit) >= 10000n, -32602, 'Invalid params: verificationGasLimit must be at least 10000');

    if (BigInt(userOp.preVerificationGas) === 0n || BigInt(userOp.verificationGasLimit) === 0n || BigInt(userOp.callGasLimit) === 0n) {
        throw new AppException(-32602, 'Invalid params: gas limits must be larger than 0');
    }

    const bundlerConfig = getBundlerChainConfig(chainId);
    const gasLimit = calcUserOpTotalGasLimit(userOp, chainId);
    Helper.assertTrue(gasLimit < bundlerConfig.maxBundleGas, -32602, 'GasLimit is too large');

    const userOpHash = getUserOpHashV06(chainId, userOp, entryPoint);
    const userOpSender = getAddress(userOp.sender);
    const { nonceKey, nonceValue } = splitOriginNonce(userOp.nonce);

    if (userOp.paymasterAndData !== '0x') {
        const paymaster = getAddress(userOp.paymasterAndData.slice(0, 42));
        if (PAYMASTER_CHECK.includes(paymaster)) {
            const expiredAt = parsePaymasterAndDataAndGetExpiredAt(userOp.paymasterAndData);
            Helper.assertTrue(expiredAt * 1000 > Date.now(), -32602, 'Paymaster expired');
        }

        if (!isAuth) {
            Helper.assertTrue(isAddress(paymaster), -32602, 'Invalid params: paymaster address');
            Helper.assertTrue(!FORBIDDEN_PAYMASTER.includes(getAddress(paymaster)), -32602, 'Forbidden paymaster');
        }
    }

    let userOperationEntity: UserOperationEntity;
    if (isAuth && skipVerification) {
        userOperationEntity = await rpcService.userOperationService.getUserOperationByAddressNonce(
            chainId,
            userOpSender,
            BigInt(nonceKey).toString(),
            Number(BigInt(nonceValue)),
        );
    } else {
        Helper.assertTrue(
            BigInt(userOp.preVerificationGas) >= BigInt(calcPreVerificationGas(userOp) - 1000),
            -32602,
            'preVerificationGas is too low',
        );

        const [rSimulation, extraFee, signerFeeData, userOpEntity, localUserOperationsCount] = await Promise.all([
            simulateHandleOpAndGetGasCost(rpcService, chainId, userOp, entryPoint),
            getL2ExtraFee(rpcService, chainId, userOp, entryPoint),
            rpcService.chainService.getFeeDataIfCache(chainId),
            rpcService.userOperationService.getUserOperationByAddressNonce(
                chainId,
                userOpSender,
                BigInt(nonceKey).toString(),
                Number(BigInt(nonceValue)),
            ),
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
        userOperationEntity = userOpEntity;
    }

    return {
        userOpHash,
        userOperationEntity,
    };
}

export async function createOrUpdateUserOperation(
    userOperationService: UserOperationService,
    chainId: number,
    userOp: any,
    userOpHash: string,
    entryPoint: string,
    userOperationEntity?: UserOperationEntity,
) {
    await userOperationService.createOrUpdateUserOperation(chainId, userOp, userOpHash, entryPoint, userOperationEntity);

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
    userOp.maxFeePerGas = '0x1';
    userOp.maxPriorityFeePerGas = '0x1';

    const contractEntryPoint = rpcService.getSetCachedContract(entryPoint, entryPointAbis.v06);

    const signers = rpcService.signerService.getChainSigners(chainId);
    const txSimulateHandleOp = await contractEntryPoint.simulateHandleOp.populateTransaction(userOp, ZeroAddress, '0x', {
        from: signers[0].address,
    });

    let [resultCallSimulateHandleOp, gasCostWholeTransaction] = await Promise.all([
        rpcService.chainService.staticCall(chainId, txSimulateHandleOp, true, stateOverride),
        tryGetGasCostWholeTransaction(chainId, rpcService, contractEntryPoint, entryPoint, userOp),
    ]);

    // Compatibility with VICTION_NETWORK, IOTEX_NETWORK
    if (
        [EVM_CHAIN_ID.VICTION_MAINNET, EVM_CHAIN_ID.VICTION_TESTNET, EVM_CHAIN_ID.IOTEX_MAINNET, EVM_CHAIN_ID.IOTEX_TESTNET].includes(chainId) &&
        !!resultCallSimulateHandleOp.result
    ) {
        resultCallSimulateHandleOp.error = { data: resultCallSimulateHandleOp.result };
    }

    Helper.assertTrue(
        !!resultCallSimulateHandleOp?.error?.data,
        10001,
        `SimulateHandleOp call error on chain ${chainId}: ${Helper.converErrorToString(resultCallSimulateHandleOp)}`,
    );

    // Compatibility with GNOSIS_NETWORK, FUSE_NETWORK
    if (resultCallSimulateHandleOp.error.data.startsWith('Reverted ')) {
        resultCallSimulateHandleOp.error.data = resultCallSimulateHandleOp.error.data.replace('Reverted ', '');
    }
    // Compatibility with BEVM
    if (!resultCallSimulateHandleOp.error.data.startsWith('0x')) {
        resultCallSimulateHandleOp.error.data = `0x${resultCallSimulateHandleOp.error.data}`;
    }

    const errorCallSimulateHandleOp = contractEntryPoint.interface.parseError(resultCallSimulateHandleOp.error.data);
    if (errorCallSimulateHandleOp?.name === 'FailedOp') {
        if (!IS_PRODUCTION) {
            console.error(errorCallSimulateHandleOp);
        }

        throw new AppException(-32606, `Simulate user operation failed: ${errorCallSimulateHandleOp?.args.at(-1)}`);
    }

    const gasCostInContract = toBeHex(errorCallSimulateHandleOp?.args[1]);
    let verificationGasLimit = ((BigInt(errorCallSimulateHandleOp?.args[0]) - BigInt(userOp.preVerificationGas)) * 3n) / 2n;
    if (verificationGasLimit < 100000n) {
        verificationGasLimit = 100000n;
    }

    return { gasCostInContract, gasCostWholeTransaction, verificationGasLimit: toBeHex(verificationGasLimit) };
}

function checkUserOpGasPriceIsSatisfied(chainId: number, userOp: any, gasCost: bigint, extraFee: string, signerFeeData?: any) {
    const signerGasPrice = SUPPORT_EIP_1559.includes(chainId)
        ? calcUserOpGasPrice(signerFeeData, signerFeeData.baseFee)
        : signerFeeData.gasPrice;
    const userOpGasPrice = calcUserOpGasPrice(userOp, signerFeeData.baseFee);

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

async function checkUserOpCanExecutedSucceed(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    try {
        await tryPreExecuteUserOp(rpcService, chainId, userOp, entryPoint);
    } catch (error) {
        if (!IS_PRODUCTION) {
            console.error(error);
        }

        throw new AppException(
            -32606,
            `Check user operation failed: ${
                error?.revert?.args.at(-1) ??
                (error?.info?.error?.code === 10001 ? 'Node RPC Error' : null) ??
                error?.shortMessage ??
                error?.message
            }`,
            error?.transaction,
        );
    }
}

async function tryGetGasCostWholeTransaction(
    chainId: number,
    rpcService: RpcService,
    contractEntryPoint: Contract,
    entryPoint: string,
    userOp: any,
) {
    if (!SUPPORT_MULTCALL3.includes(chainId)) {
        return '0x00';
    }

    const simulateHandleOpTx = await contractEntryPoint.simulateHandleOp.populateTransaction(userOp, ZeroAddress, '0x');
    const multiCallContract = rpcService.getSetCachedContract(MULTI_CALL_3_ADDRESS, MultiCall3Abi);
    const signer = rpcService.signerService.getChainSigners(chainId)[0];
    const toEstimatedTx = await multiCallContract.tryAggregate.populateTransaction(false, [
        {
            target: entryPoint,
            callData: simulateHandleOpTx.data,
        },
    ]);

    toEstimatedTx.from = signer.address;
    return toBeHex(await rpcService.chainService.estimateGas(chainId, toEstimatedTx));
}
