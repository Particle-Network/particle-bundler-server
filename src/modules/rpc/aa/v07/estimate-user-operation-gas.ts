import { getAddress, toBeHex } from 'ethers';
import { RpcService } from '../../services/rpc.service';
import { Helper } from '../../../../common/helper';
import { JsonRPCRequestDto } from '../../dtos/json-rpc-request.dto';
import { DUMMY_SIGNATURE } from '../../../../common/common-types';
import {
    calcPreVerificationGasV07,
    calcUserOpGasPrice,
    getL2ExtraFee,
    isUserOpValidV07,
    packAccountGasLimits,
    packUint,
    toBeHexTrimZero,
} from '../utils';
import { estimateGasLimit, tryEstimateGasForFirstAccount } from '../v06';
import { EVM_CHAIN_ID, L2_GAS_ORACLE, NEED_TO_ESTIMATE_GAS_BEFORE_SEND, SUPPORT_EIP_1559 } from '../../../../common/chains';
import { simulateHandleOpAndGetGasCost } from './send-user-operation';
import { Logger } from '@nestjs/common';
import { AppException } from '../../../../common/app-exception';

export async function estimateUserOperationGas(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, 'Invalid params: userop must be an object');

    const userOp = body.params[0];
    const entryPoint = getAddress(body.params[1]);

    let stateOverride: any = null;
    if (!!body.params[2]) {
        stateOverride = body.params[2]?.stateOverride;
    }

    // Init default value
    userOp.gasFees = packUint(1, 1);
    userOp.accountGasLimits = packAccountGasLimits(1000000, 1000000);
    userOp.preVerificationGas = '0x00';

    if (!userOp.signature || userOp.signature === '0x') {
        userOp.signature = DUMMY_SIGNATURE;
    }

    userOp.preVerificationGas = toBeHex(calcPreVerificationGasV07(userOp));
    Helper.assertTrue(isUserOpValidV07(userOp), -32602, 'Invalid userOp');

    let [{ callGasLimit, initGas }, { gasFees, verificationGasLimit, gasCostInContract, gasCostWholeTransaction }] = await Promise.all([
        estimateGasLimit(rpcService, chainId, entryPoint, userOp, stateOverride),
        calculateGasPrice(rpcService, chainId, userOp, entryPoint, stateOverride),
        tryEstimateGasForFirstAccount(rpcService, chainId, userOp, stateOverride),
    ]);

    if (initGas > 0n && gasCostInContract > initGas) {
        callGasLimit = gasCostInContract - initGas;
    }

    userOp.accountGasLimits = packAccountGasLimits(verificationGasLimit, callGasLimit);
    userOp.gasFees = gasFees;

    if (NEED_TO_ESTIMATE_GAS_BEFORE_SEND.includes(chainId) && gasCostWholeTransaction - gasCostInContract > BigInt(userOp.preVerificationGas)) {
        userOp.preVerificationGas = toBeHex(gasCostWholeTransaction - gasCostInContract);
    }

    try {
        return {
            gasCostWholeTransaction: toBeHexTrimZero(gasCostWholeTransaction),
            gasFees: userOp.gasFees,
            accountGasLimits: userOp.accountGasLimits,
            preVerificationGas: userOp.preVerificationGas,
            verificationGasLimit: toBeHexTrimZero(verificationGasLimit),
            callGasLimit: toBeHexTrimZero(callGasLimit),
        };
    } catch (error) {
        if (error instanceof AppException) {
            throw error;
        }

        Logger.error(error);

        throw new AppException(-32005, error?.message);
    }
}

async function calculateGasPrice(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string, stateOverride?: any) {
    const [rSimulation, userOpFeeData, extraFee] = await Promise.all([
        simulateHandleOpAndGetGasCost(rpcService, chainId, userOp, entryPoint, stateOverride),
        rpcService.chainService.getFeeDataIfCache(chainId),
        getL2ExtraFee(rpcService, chainId, userOp, entryPoint),
    ]);

    const gasCostInContract = BigInt(rSimulation.gasCostInContract);
    const gasCostWholeTransaction = BigInt(rSimulation.gasCostWholeTransaction);
    const gasCost = NEED_TO_ESTIMATE_GAS_BEFORE_SEND.includes(chainId)
        ? gasCostWholeTransaction > gasCostInContract
            ? gasCostWholeTransaction
            : gasCostInContract
        : gasCostInContract;

    userOp.gasFees = SUPPORT_EIP_1559.includes(chainId)
        ? packUint(userOpFeeData.maxPriorityFeePerGas, userOpFeeData.maxFeePerGas)
        : packUint(userOpFeeData.gasPrice, userOpFeeData.gasPrice);

    const userOpGasPrice = SUPPORT_EIP_1559.includes(chainId)
        ? calcUserOpGasPrice(userOpFeeData, userOpFeeData.baseFee)
        : userOpFeeData.gasPrice;

    let minGasPrice = BigInt(userOpGasPrice);
    if (Object.keys(L2_GAS_ORACLE).includes(String(chainId))) {
        const signerPaid = (gasCost + 5000n) * BigInt(userOpGasPrice);
        minGasPrice = (BigInt(extraFee) + signerPaid) / gasCost;
    }

    let ratio = 1;

    if ([EVM_CHAIN_ID.POLYGON_MAINNET, EVM_CHAIN_ID.POLYGON_AMOY_TESTNET].includes(chainId)) {
        ratio = 1.05;
    }

    if ([EVM_CHAIN_ID.CYBER_MAINNET, EVM_CHAIN_ID.CYBER_TESTNET].includes(chainId)) {
        ratio = 2;
    }

    minGasPrice = (minGasPrice * BigInt(Math.round(ratio * 100))) / 100n;

    if (BigInt(userOpGasPrice) < minGasPrice) {
        const diff = minGasPrice - BigInt(userOpGasPrice);
        userOp.gasFees = packUint(BigInt(userOpFeeData.maxPriorityFeePerGas) + diff, BigInt(userOpFeeData.maxFeePerGas) + diff);
    }

    return {
        gasFees: userOp.gasFees,
        verificationGasLimit: rSimulation.verificationGasLimit,
        gasCostInContract,
        gasCostWholeTransaction,
    };
}
