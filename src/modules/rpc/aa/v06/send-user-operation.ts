import { Contract, ZeroAddress, getAddress, toBeHex } from 'ethers';
import { JsonRPCRequestDto } from '../../dtos/json-rpc-request.dto';
import { RpcService } from '../../services/rpc.service';
import { Helper } from '../../../../common/helper';
import { IS_PRODUCTION, MULTI_CALL_3_ADDRESS, PROCESS_EVENT_TYPE } from '../../../../common/common-types';
import { AppException } from '../../../../common/app-exception';
import { calcUserOpGasPrice, calcUserOpTotalGasLimit, getUserOpHash, isUserOpValid, splitOriginNonce } from '../utils';
import { getBundlerChainConfig } from '../../../../configs/bundler-common';
import EntryPointAbi from '../abis/entry-point-abi';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import l1GasPriceOracleAbi from '../abis/l1-gas-price-oracle-abi';
import { cloneDeep } from 'lodash';
import MultiCall3Abi from '../abis/multi-call-3-abi';
import { EVM_CHAIN_ID, L2_GAS_ORACLE, SUPPORT_EIP_1559, USE_PROXY_CONTRACT_TO_ESTIMATE_GAS } from '../../../../common/chains';
import { ProcessEventEmitter } from '../../../../common/process-event-emitter';

export async function sendUserOperation(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, 'Invalid params: userop must be an object');
    const userOp = body.params[0];
    const entryPoint = getAddress(body.params[1]);

    Helper.assertTrue(isUserOpValid(userOp), -32602, 'Invalid userOp');
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

    const [rSimulation, extraFee, signerFeeData, userOpDoc] = await Promise.all([
        simulateHandleOpAndGetGasCost(rpcService, chainId, userOp, entryPoint),
        getL2ExtraFee(rpcService, chainId, userOp, entryPoint),
        rpcService.aaService.getFeeData(chainId),
        rpcService.aaService.userOperationService.getUserOperationByAddressNonce(chainId, userOpSender, nonceKey, BigInt(nonceValue).toString()),
        // do not care return value
        checkUserOpCanExecutedSucceed(rpcService, chainId, userOp, entryPoint),
    ]);

    const gasCostInContract = BigInt(rSimulation.gasCostInContract);
    const gasCostWholeTransaction = BigInt(rSimulation.gasCostWholeTransaction);
    const gasCost = gasCostWholeTransaction > gasCostInContract ? gasCostWholeTransaction : gasCostInContract;

    checkUserOpGasPriceIsSatisfied(chainId, userOp, gasCost, extraFee, signerFeeData);

    const newUserOpDoc = await rpcService.aaService.userOperationService.createOrUpdateUserOperation(
        chainId,
        userOp,
        userOpHash,
        entryPoint,
        userOpDoc,
    );

    ProcessEventEmitter.sendMessages(PROCESS_EVENT_TYPE.CREATE_USER_OPERATION, { chainId, userOpDoc: newUserOpDoc.toJSON() });

    return userOpHash;
}

export async function simulateHandleOpAndGetGasCost(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    userOp = cloneDeep(userOp);
    userOp.maxFeePerGas = '0x1';
    userOp.maxPriorityFeePerGas = '0x1';

    const provider = rpcService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPoint, EntryPointAbi, provider);

    const signers = rpcService.aaService.getChainSigners(chainId);
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

    const provider = rpcService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPoint, EntryPointAbi, provider);
    const l1GasPriceOracleContract = new Contract(L2_GAS_ORACLE[chainId], l1GasPriceOracleAbi, provider);

    const fakeSigner = rpcService.aaService.getChainSigners(chainId)[0];
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
    const provider = rpcService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPoint, EntryPointAbi, provider);
    const signer = rpcService.aaService.getChainSigners(chainId)[0];

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
    const provider = rpcService.getJsonRpcProvider(chainId);
    if (!USE_PROXY_CONTRACT_TO_ESTIMATE_GAS.includes(chainId)) {
        return '0x00';
    }

    const simulateHandleOpTx = await contractEntryPoint.simulateHandleOp.populateTransaction(userOp, ZeroAddress, '0x');
    const multiCallContract = new Contract(MULTI_CALL_3_ADDRESS, MultiCall3Abi, provider);
    const signer = rpcService.aaService.getChainSigners(chainId)[0];
    const toEstimatedTx = await multiCallContract.tryAggregate.populateTransaction(false, [
        {
            target: entryPoint,
            callData: simulateHandleOpTx.data,
        },
    ]);

    toEstimatedTx.from = signer.address;
    return toBeHex(await provider.estimateGas(toEstimatedTx));
}
