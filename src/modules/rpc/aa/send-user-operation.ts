import { Contract, getAddress, isAddress } from 'ethers';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { BUNDLING_MODE, GAS_FEE_LEVEL, keyEventSendUserOperation } from '../../../common/common-types';
import {
    AppException,
    AppExceptionMessages,
    MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS,
    MESSAGE_32602_INVALID_PARAMS_LENGTH,
    MESSAGE_32602_INVALID_USEROP_TYPE,
} from '../../../common/app-exception';
import { calcUserOpGasPrice, calcUserOpTotalGasLimit, getFeeDataFromParticle, isUserOpValid } from './utils';
import { BigNumber } from '../../../common/bignumber';
import { EVM_CHAIN_ID, L2_GAS_ORACLE, SUPPORT_EIP_1559, getBundlerConfig } from '../../../configs/bundler-common';
import entryPointAbi from './entry-point-abi';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import { Logger } from '@nestjs/common';
import l1GasPriceOracleAbi from './l1-gas-price-oracle-abi';
import { cloneDeep, isArray } from 'lodash';

export async function sendUserOperation(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 2, -32602, MESSAGE_32602_INVALID_PARAMS_LENGTH);
    const userOp = body.params[0];
    let entryPointInput = getAddress(body.params[1]);

    Helper.assertTrue(typeof body.params[0] === 'object', -32602, MESSAGE_32602_INVALID_USEROP_TYPE);
    Helper.assertTrue(typeof body.params[1] === 'string' && isAddress(body.params[1]), -32602, MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS);

    entryPointInput = getAddress(entryPointInput);
    const bundlerConfig = getBundlerConfig(chainId);
    Helper.assertTrue(bundlerConfig.SUPPORTED_ENTRYPOINTS.includes(entryPointInput), -32003);

    Helper.assertTrue(isUserOpValid(userOp), -32602, AppExceptionMessages.messageExtend(-32602, `Invalid userOp`));
    Helper.assertTrue(
        BigNumber.from(userOp.verificationGasLimit).gte(10000),
        -32602,
        AppExceptionMessages.messageExtend(-32602, `verificationGasLimit must be at least 10000`),
    );

    if (
        BigNumber.from(userOp.preVerificationGas).eq(0) ||
        BigNumber.from(userOp.verificationGasLimit).eq(0) ||
        BigNumber.from(userOp.callGasLimit).eq(0)
    ) {
        throw new AppException(-32602, AppExceptionMessages.messageExtend(-32602, 'Gas limits must be larger than 0'));
    }

    const gasLimit = calcUserOpTotalGasLimit(userOp);
    Helper.assertTrue(gasLimit.lt(bundlerConfig.MAX_BUNDLE_GAS), -32602, AppExceptionMessages.messageExtend(-32602, 'gasLimit is too large'));

    Helper.assertTrue(
        BigNumber.from(userOp.preVerificationGas).gte(calcPreVerificationGas(userOp) - 1000),
        -32602,
        'preVerificationGas is too low',
    );

    const gasCost = await simulateHandleOpAndGetGasCost(rpcService, chainId, userOp, entryPointInput);
    const extraFee = await getL2ExtraFee(rpcService, chainId, userOp, entryPointInput);
    await checkUserOpGasPriceIsSatisfied(chainId, userOp, gasCost, extraFee);

    const userOpHash = await getUserOpHash(rpcService, chainId, userOp, entryPointInput);
    await checkUserOpNonce(rpcService, chainId, userOp, entryPointInput);

    await rpcService.aaService.userOperationService.createOrUpdateUserOperation(chainId, userOp, userOpHash, entryPointInput);

    if (rpcService.aaService.getBundlingMode() === BUNDLING_MODE.AUTO) {
        rpcService.redisService.getClient().publish(keyEventSendUserOperation, JSON.stringify({ chainId }));
    }

    return userOpHash;
}

export async function simulateHandleOpAndGetGasCost(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    userOp = cloneDeep(userOp);
    userOp.maxFeePerGas = '0x1';
    userOp.maxPriorityFeePerGas = '0x1';

    const provider = rpcService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPoint, entryPointAbi, provider);

    let errorResult = await contractEntryPoint.simulateHandleOp
        .staticCall(userOp, '0x0000000000000000000000000000000000000000', '0x')
        .catch((e) => e);

    if (!errorResult?.revert) {
        // Comptibility with OKBC_NETWORK
        if ([EVM_CHAIN_ID.OKBC_TESTNET].includes(chainId) && typeof errorResult?.info?.error?.message === 'string') {
            const revert = JSON.parse(errorResult?.info?.error?.message);
            const tx = errorResult.transaction;
            errorResult = contractEntryPoint.interface.makeError(revert[1], tx);
        }
        // Comptibility with GNOSIS_NETWORK
        if ([EVM_CHAIN_ID.GNOSIS_MAINNET, EVM_CHAIN_ID.GNOSIS_TESTNET].includes(chainId) && !!errorResult?.info?.error?.data) {
            const tx = errorResult.transaction;
            const data = errorResult.info.error.data.replace('Reverted ', '');
            errorResult = contractEntryPoint.interface.makeError(data, tx);
        }
    }

    Helper.assertTrue(!!errorResult?.revert, -32000, 'Can not simulate the user op');
    if (errorResult?.revert?.name === 'FailedOp') {
        throw new AppException(-32606, AppExceptionMessages.messageExtend(-32606, errorResult?.revert?.args.at(-1)));
    }

    return BigNumber.from(errorResult?.revert?.args[1]).toHexString();
}

export async function getL2ExtraFee(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    if (!Object.keys(L2_GAS_ORACLE).includes(String(chainId))) {
        return BigNumber.from(0).toHexString();
    }

    const provider = rpcService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPoint, entryPointAbi, provider);
    const l1GasPriceOracleContract = new Contract(L2_GAS_ORACLE[String(chainId)], l1GasPriceOracleAbi, provider);

    const fakeSigner = rpcService.aaService.getSigners()[0];
    const simulateTx = await contractEntryPoint.handleOps.populateTransaction([userOp], fakeSigner.address);
    simulateTx.from = fakeSigner.address;

    const rawTransaction = await fakeSigner.signTransaction(simulateTx);

    const l2ExtraFee = await l1GasPriceOracleContract.getL1Fee(rawTransaction);
    return BigNumber.from(l2ExtraFee).toHexString();
}

async function getUserOpHash(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    const provider = rpcService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPoint, entryPointAbi, provider);

    return await contractEntryPoint.getUserOpHash(userOp);
}

async function checkUserOpGasPriceIsSatisfied(chainId: number, userOp: any, gasCost: any, extraFee: any) {
    const signerFeeData = await getFeeDataFromParticle(chainId, GAS_FEE_LEVEL.MEDIUM);
    const signerGasPrice = SUPPORT_EIP_1559.includes(chainId)
        ? calcUserOpGasPrice(signerFeeData, signerFeeData.baseFee)
        : signerFeeData.gasPrice;
    const userOpGasPrice = calcUserOpGasPrice(userOp, signerFeeData.baseFee);

    Helper.assertTrue(
        BigNumber.from(userOpGasPrice).gte(signerGasPrice),
        -32602,
        `maxFeePerGas or maxPriorityFeePerGas is too low, userOpGasPrice can not be lower than ${signerGasPrice}`,
    );

    // TODO HACK temporary not strict check for opBNB and Combo
    if (chainId === EVM_CHAIN_ID.OPBNB_MAINNET || chainId === EVM_CHAIN_ID.OPBNB_TESTNET || chainId === EVM_CHAIN_ID.COMBO_TESTNET) {
        const minUserOpGasPrice = 5 * 10 ** 8;
        Helper.assertTrue(BigNumber.from(userOpGasPrice).gte(minUserOpGasPrice), -32602, `maxFeePerGas or maxPriorityFeePerGas is too low`);
        return;
    }

    const signerPaid = BigNumber.from(gasCost).add(1000).mul(signerGasPrice);

    // userOpPaid = gasCost * userOpGasPrice
    // signerPaid = gasCost * signerGasPrice
    // userOpPaid - signerPaid > extraFee (L1 Fee)

    const diff = BigNumber.from(gasCost).mul(userOpGasPrice).sub(signerPaid);
    Helper.assertTrue(diff.gte(extraFee), -32602, `maxFeePerGas or maxPriorityFeePerGas is too low`);
}

async function checkUserOpNonce(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    if (!BigNumber.from(userOp.nonce).eq(0)) {
        const provider = rpcService.getJsonRpcProvider(chainId);
        const epContract = new Contract(entryPoint, entryPointAbi, provider);
        let [remoteNonce, localMaxNonce] = await Promise.all([
            epContract.getNonce(userOp.sender, 0),
            rpcService.aaService.userOperationService.getSuccessUserOperationNonce(chainId, getAddress(userOp.sender)),
        ]);

        localMaxNonce = BigNumber.from(localMaxNonce ?? '-1')
            .add(1)
            .toHexString();
        const targetNonce = BigNumber.from(localMaxNonce).gt(remoteNonce) ? localMaxNonce : remoteNonce;

        Helper.assertTrue(
            BigNumber.from(userOp.nonce).gte(targetNonce),
            -32602,
            AppExceptionMessages.messageExtend(-32602, 'AA25 invalid account nonce'),
        );
    }
}
