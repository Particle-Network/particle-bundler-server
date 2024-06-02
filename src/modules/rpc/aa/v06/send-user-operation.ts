import { Contract, ZeroAddress, getAddress, isAddress, toBeHex } from 'ethers';
import { JsonRPCRequestDto } from '../../dtos/json-rpc-request.dto';
import { RpcService } from '../../services/rpc.service';
import { Helper } from '../../../../common/helper';
import { IS_PRODUCTION, MULTI_CALL_3_ADDRESS } from '../../../../common/common-types';
import { AppException } from '../../../../common/app-exception';
import {
    calcUserOpGasPrice,
    calcUserOpTotalGasLimit,
    getUserOpHash,
    isUserOpValid,
    parsePaymasterAndDataAndGetExpiredAt,
    splitOriginNonce,
} from '../utils';
import { FORBIDDEN_PAYMASTER, PAYMASTER_CHECK, getBundlerChainConfig } from '../../../../configs/bundler-common';
import EntryPointAbi from '../abis/entry-point-abi';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import l1GasPriceOracleAbi from '../abis/l1-gas-price-oracle-abi';
import { cloneDeep } from 'lodash';
import MultiCall3Abi from '../abis/multi-call-3-abi';
import {
    EVM_CHAIN_ID,
    L2_GAS_ORACLE,
    PARTICLE_CHAINS,
    SUPPORT_EIP_1559,
    SUPPORT_MULTCALL3,
    USE_PROXY_CONTRACT_TO_ESTIMATE_GAS,
} from '../../../../common/chains';
import { UserOperationDocument } from '../../schemas/user-operation.schema';
import { UserOperationService } from '../../services/user-operation.service';

export async function sendUserOperation(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, 'Invalid params: userop must be an object');
    const userOp = body.params[0];
    const entryPoint = getAddress(body.params[1]);
    Helper.assertTrue(isUserOpValid(userOp), -32602, 'Invalid userOp');

    const { userOpHash, userOperationDocument } = await beforeSendUserOperation(rpcService, chainId, userOp, entryPoint, body.isAuth);
    
    return await createOrUpdateUserOperation(rpcService.userOperationService, chainId, userOp, userOpHash, entryPoint, userOperationDocument);
}

export async function beforeSendUserOperation(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string, isAuth: boolean) {
    Helper.assertTrue(BigInt(userOp.verificationGasLimit) >= 10000n, -32602, 'Invalid params: verificationGasLimit must be at least 10000');

    if (BigInt(userOp.preVerificationGas) === 0n || BigInt(userOp.verificationGasLimit) === 0n || BigInt(userOp.callGasLimit) === 0n) {
        throw new AppException(-32602, 'Invalid params: gas limits must be larger than 0');
    }

    const bundlerConfig = getBundlerChainConfig(chainId);
    const gasLimit = calcUserOpTotalGasLimit(userOp, chainId);
    Helper.assertTrue(gasLimit < bundlerConfig.maxBundleGas, -32602, 'GasLimit is too large');

    Helper.assertTrue(
        BigInt(userOp.preVerificationGas) >= BigInt(calcPreVerificationGas(userOp) - 1000),
        -32602,
        'preVerificationGas is too low',
    );

    const userOpHash = getUserOpHash(chainId, userOp, entryPoint);
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

    let userOperationDocument: UserOperationDocument;
    if (!isAuth || !PARTICLE_CHAINS.includes(chainId)) {
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
        const gasCost = USE_PROXY_CONTRACT_TO_ESTIMATE_GAS.includes(chainId)
            ? gasCostWholeTransaction > gasCostInContract
                ? gasCostWholeTransaction
                : gasCostInContract
            : gasCostInContract;

        checkUserOpGasPriceIsSatisfied(chainId, userOp, gasCost, extraFee, signerFeeData);
        userOperationDocument = userOpDoc;
    } else {
        userOperationDocument = await rpcService.userOperationService.getUserOperationByAddressNonce(
            chainId,
            userOpSender,
            nonceKey,
            BigInt(nonceValue).toString(),
        );
    }

    return {
        userOpHash,
        userOperationDocument,
    };
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

export async function simulateHandleOpAndGetGasCost(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    userOp = cloneDeep(userOp);
    userOp.maxFeePerGas = '0x1';
    userOp.maxPriorityFeePerGas = '0x1';

    const provider = rpcService.chainService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPoint, EntryPointAbi, provider);

    const signers = rpcService.signerService.getChainSigners(chainId);
    let [errorResult, gasCostWholeTransaction] = await Promise.all([
        contractEntryPoint.simulateHandleOp.staticCall(userOp, ZeroAddress, '0x', { from: signers[0].address }).catch((e) => e),
        tryGetGasCostWholeTransaction(chainId, rpcService, contractEntryPoint, entryPoint, userOp),
    ]);

    if (!errorResult?.revert) {
        // Comptibility with GNOSIS_NETWORK
        if ([EVM_CHAIN_ID.GNOSIS_MAINNET, EVM_CHAIN_ID.GNOSIS_TESTNET].includes(chainId) && !!errorResult?.info?.error?.data) {
            const tx = errorResult.transaction;
            const data = errorResult.info.error.data.replace('Reverted ', '');
            errorResult = contractEntryPoint.interface.makeError(data, tx);
        }
        // Comptibility with VICTION_NETWORK
        if ([EVM_CHAIN_ID.VICTION_MAINNET, EVM_CHAIN_ID.VICTION_TESTNET].includes(chainId) && !!errorResult?.value) {
            const tx = await contractEntryPoint.simulateHandleOp.populateTransaction(userOp, '0x0000000000000000000000000000000000000000', '0x');
            errorResult = contractEntryPoint.interface.makeError(errorResult.value, tx);
        }
        // Comptibility with BEVM
        if (
            [EVM_CHAIN_ID.BEVM_CANARY_MAINNET, EVM_CHAIN_ID.BEVM_CANARY_TESTNET, EVM_CHAIN_ID.BEVM_TESTNET].includes(chainId) &&
            !!errorResult?.info?.error?.data
        ) {
            if (!errorResult.info.error.data.startsWith('0x')) {
                const tx = errorResult.transaction;
                const data = '0x' + errorResult.info.error.data;
                errorResult = contractEntryPoint.interface.makeError(data, tx);
            }
        }
    }

    Helper.assertTrue(!!errorResult?.revert, -32000, 'Can not simulate the user op, No revert message');
    if (errorResult?.revert?.name === 'FailedOp') {
        if (!IS_PRODUCTION) {
            console.error(errorResult);
        }

        throw new AppException(-32606, `Simulate user operation failed: ${errorResult?.revert?.args.at(-1)}`);
    }

    const gasCostInContract = toBeHex(errorResult?.revert?.args[1]);
    let verificationGasLimit = ((BigInt(errorResult?.revert?.args[0]) - BigInt(userOp.preVerificationGas)) * 3n) / 2n;
    if (verificationGasLimit < 100000n) {
        verificationGasLimit = 100000n;
    }

    return { gasCostInContract, gasCostWholeTransaction, verificationGasLimit: toBeHex(verificationGasLimit) };
}

export async function getL2ExtraFee(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    if (!Object.keys(L2_GAS_ORACLE).includes(String(chainId))) {
        return '0x00';
    }

    const provider = rpcService.chainService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPoint, EntryPointAbi, provider);
    const l1GasPriceOracleContract = new Contract(L2_GAS_ORACLE[chainId], l1GasPriceOracleAbi, provider);

    const fakeSigner = rpcService.signerService.getChainSigners(chainId)[0];
    const simulateTx = await contractEntryPoint.handleOps.populateTransaction([userOp], fakeSigner.address);
    simulateTx.from = fakeSigner.address;

    const rawTransaction = await fakeSigner.signTransaction(simulateTx);

    const l2ExtraFee = await l1GasPriceOracleContract.getL1Fee(rawTransaction);
    return toBeHex(l2ExtraFee);
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
    // Fault tolerance 15%
    if (toleranceGap <= 1500n) {
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
    const provider = rpcService.chainService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPoint, EntryPointAbi, provider);
    const signer = rpcService.signerService.getChainSigners(chainId)[0];

    const promises = [contractEntryPoint.handleOps.staticCall([userOp], signer.address, { from: signer.address })];
    const { nonceValue } = splitOriginNonce(userOp.nonce);

    // check account exists to replace check nonce??
    if (BigInt(nonceValue) >= 1n) {
        // check account call is success because entry point will catch the error
        promises.push(
            provider.estimateGas({
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

async function tryGetGasCostWholeTransaction(
    chainId: number,
    rpcService: RpcService,
    contractEntryPoint: Contract,
    entryPoint: string,
    userOp: any,
) {
    const provider = rpcService.chainService.getJsonRpcProvider(chainId);
    if (!SUPPORT_MULTCALL3.includes(chainId)) {
        return '0x00';
    }

    const simulateHandleOpTx = await contractEntryPoint.simulateHandleOp.populateTransaction(userOp, ZeroAddress, '0x');
    const multiCallContract = new Contract(MULTI_CALL_3_ADDRESS, MultiCall3Abi, provider);
    const signer = rpcService.signerService.getChainSigners(chainId)[0];
    const toEstimatedTx = await multiCallContract.tryAggregate.populateTransaction(false, [
        {
            target: entryPoint,
            callData: simulateHandleOpTx.data,
        },
    ]);

    toEstimatedTx.from = signer.address;
    return toBeHex(await provider.estimateGas(toEstimatedTx));
}
