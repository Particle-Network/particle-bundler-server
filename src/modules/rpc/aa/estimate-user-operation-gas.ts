import { AbiCoder, JsonRpcProvider, getAddress, isAddress } from 'ethers';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import { calcUserOpGasPrice, deepHexlify, getFeeDataFromParticle, hexConcat, isUserOpValid } from './utils';
import { BigNumber } from '../../../common/bignumber';
import {
    AppException,
    AppExceptionMessages,
    MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS,
    MESSAGE_32602_INVALID_USEROP_TYPE,
} from '../../../common/app-exception';
import { EVM_CHAIN_ID, L2_GAS_ORACLE, SUPPORT_EIP_1559, getBundlerConfig } from '../../../configs/bundler-common';
import { Logger } from '@nestjs/common';
import { DUMMY_SIGNATURE, GAS_FEE_LEVEL } from '../../../common/common-types';
import { getL2ExtraFee, simulateHandleOpAndGetGasCost } from './send-user-operation';

const abiCoder = AbiCoder.defaultAbiCoder();
export async function estimateUserOperationGas(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, MESSAGE_32602_INVALID_USEROP_TYPE);
    Helper.assertTrue(typeof body.params[1] === 'string' && isAddress(body.params[1]), -32602, MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS);

    let userOp = body.params[0];
    const entryPoint = getAddress(body.params[1]);
    const bundlerConfig = getBundlerConfig(chainId);
    Helper.assertTrue(bundlerConfig.SUPPORTED_ENTRYPOINTS.includes(entryPoint), -32003);

    userOp.maxFeePerGas = '0x1';
    userOp.maxPriorityFeePerGas = '0x1';
    userOp.preVerificationGas = BigNumber.from(1000000).toHexString();
    userOp.verificationGasLimit = BigNumber.from(1000000).toHexString();
    userOp.callGasLimit = BigNumber.from(10000000).toHexString();

    if (!userOp.signature || userOp.signature === '0x') {
        userOp.signature = DUMMY_SIGNATURE;
    }

    const paymasterAddress = await rpcService.getValidPaymasterAddress(chainId);
    if (!!paymasterAddress && userOp.paymasterAndData === '0x') {
        // dummy signature
        userOp.paymasterAndData = hexConcat([paymasterAddress, abiCoder.encode(['uint48', 'uint48'], ['0x0', '0x0']), DUMMY_SIGNATURE]);
    }

    Helper.assertTrue(isUserOpValid(userOp), -32602, AppExceptionMessages.messageExtend(-32602, `Invalid userOp`));

    const provider = rpcService.getJsonRpcProvider(chainId);
    const { callGasLimit, initGas } = await estimateGasLimit(provider, entryPoint, userOp);

    userOp.verificationGasLimit = BigNumber.from(100000).add(initGas).toHexString();
    userOp.callGasLimit = BigNumber.from(callGasLimit).toHexString();
    userOp.preVerificationGas = BigNumber.from(calcPreVerificationGas(userOp)).add(5000).toHexString();

    const { maxFeePerGas, maxPriorityFeePerGas, gasCostInContract, gasCostWholeTransaction } = await calculateGasPrice(
        rpcService,
        chainId,
        userOp,
        entryPoint,
    );
    userOp.maxFeePerGas = maxFeePerGas;
    userOp.maxPriorityFeePerGas = maxPriorityFeePerGas;
    if (initGas > 0n && BigNumber.from(gasCostInContract).gt(initGas)) {
        userOp.callGasLimit = BigNumber.from(gasCostInContract).sub(initGas).toHexString();
    }
    if (gasCostWholeTransaction.gt(gasCostInContract)) {
        userOp.preVerificationGas = gasCostWholeTransaction.sub(gasCostInContract).toHexString();
    }

    Helper.assertTrue(
        BigNumber.from(userOp.maxFeePerGas).gt(0),
        -32602,
        AppExceptionMessages.messageExtend(-32602, `maxFeePerGas must be larger than 0 during gas estimation`),
    );

    try {
        return deepHexlify({
            maxFeePerGas: userOp.maxFeePerGas,
            maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
            preVerificationGas: userOp.preVerificationGas,
            verificationGasLimit: userOp.verificationGasLimit,
            callGasLimit: userOp.callGasLimit,
        });
    } catch (error) {
        Logger.error(error);

        if (error instanceof AppException) {
            throw error;
        }

        throw new AppException(-32005, error?.message);
    }
}

async function estimateGasLimit(provider: JsonRpcProvider, entryPoint: string, userOp: any) {
    let callGasLimit = 500000n;
    let initGas = 0n;

    try {
        if (userOp.initCode?.length > 2) {
            const factory = userOp.initCode.slice(0, 42);
            const factoryInitCode = `0x${userOp.initCode.slice(42)}`;

            initGas = await provider.estimateGas({
                from: entryPoint,
                to: factory,
                data: factoryInitCode,
            });
        } else {
            callGasLimit = await provider.estimateGas({
                from: entryPoint,
                to: userOp.sender,
                data: userOp.callData,
            });
        }
    } catch (error) {
        Logger.error('EstimateGasLimit Failed', error);
        // nothing
    }

    return { callGasLimit, initGas };
}

async function calculateGasPrice(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    const rSimulation = await simulateHandleOpAndGetGasCost(rpcService, chainId, userOp, entryPoint);
    const gasCostInContract = BigNumber.from(rSimulation.gasCostInContract);
    const gasCostWholeTransaction = BigNumber.from(rSimulation.gasCostWholeTransaction);
    const gasCost = gasCostWholeTransaction.gt(gasCostInContract) ? gasCostWholeTransaction : gasCostInContract;

    const userOpFeeData = await getFeeDataFromParticle(chainId, GAS_FEE_LEVEL.MEDIUM);
    userOp.maxFeePerGas = SUPPORT_EIP_1559.includes(chainId)
        ? BigNumber.from(userOpFeeData.maxFeePerGas).toHexString()
        : BigNumber.from(userOpFeeData.gasPrice).toHexString();
    userOp.maxPriorityFeePerGas = SUPPORT_EIP_1559.includes(chainId)
        ? BigNumber.from(userOpFeeData.maxPriorityFeePerGas).toHexString()
        : BigNumber.from(userOpFeeData.gasPrice).toHexString();
    let userOpGasPrice = calcUserOpGasPrice(userOp, userOpFeeData.baseFee);

    const signerFeeData = userOpFeeData;
    const signerGasPrice = SUPPORT_EIP_1559.includes(chainId)
        ? calcUserOpGasPrice(signerFeeData, signerFeeData.baseFee)
        : signerFeeData.gasPrice;

    let minGasPrice = BigNumber.from(signerGasPrice).mul(105).div(100);
    if (Object.keys(L2_GAS_ORACLE).includes(String(chainId))) {
        const extraFee = await getL2ExtraFee(rpcService, chainId, userOp, entryPoint);
        const signerPaid = gasCost.add(5000).mul(signerGasPrice);
        minGasPrice = BigNumber.from(extraFee).add(signerPaid).div(gasCost);
    }

    if (
        [
            EVM_CHAIN_ID.POLYGON_MAINNET,
            EVM_CHAIN_ID.POLYGON_TESTNET,
            EVM_CHAIN_ID.BASE_MAINNET,
            EVM_CHAIN_ID.BASE_TESTNET,
            EVM_CHAIN_ID.PGN_MAINNET,
            EVM_CHAIN_ID.PGN_TESTNET,
            EVM_CHAIN_ID.MANTA_MAINNET,
            EVM_CHAIN_ID.MANTA_TESTNET,
            EVM_CHAIN_ID.OPTIMISM_MAINNET,
            EVM_CHAIN_ID.OPTIMISM_TESTNET,
            EVM_CHAIN_ID.MANTLE_MAINNET,
            EVM_CHAIN_ID.MANTLE_TESTNET,
            EVM_CHAIN_ID.SCROLL_MAINNET,
            EVM_CHAIN_ID.SCROLL_SEPOLIA,
        ].includes(chainId)
    ) {
        let ratio = 1.05;
        if ([EVM_CHAIN_ID.BASE_MAINNET, EVM_CHAIN_ID.BASE_TESTNET].includes(chainId)) {
            ratio = 1.15;
        } else if (
            [EVM_CHAIN_ID.PGN_MAINNET, EVM_CHAIN_ID.PGN_TESTNET, EVM_CHAIN_ID.POLYGON_MAINNET, EVM_CHAIN_ID.POLYGON_TESTNET].includes(chainId)
        ) {
            ratio = 1.25;
        }

        minGasPrice = minGasPrice.mul(Math.round(ratio * 100)).div(100);
    }

    // TODO HACK temporary not strict check for opBNB and Combo
    // at least 0.5 Gwei
    if ([EVM_CHAIN_ID.OPBNB_MAINNET, EVM_CHAIN_ID.OPBNB_TESTNET, EVM_CHAIN_ID.COMBO_MAINNET, EVM_CHAIN_ID.COMBO_TESTNET].includes(chainId)) {
        const minUserOpGasPrice = 5 * 10 ** 8;
        if (userOpGasPrice < minUserOpGasPrice) {
            const diff = BigNumber.from(minUserOpGasPrice).sub(userOpGasPrice);
            userOp.maxFeePerGas = BigNumber.from(userOp.maxFeePerGas).add(diff).toHexString();
            userOp.maxPriorityFeePerGas = BigNumber.from(userOp.maxPriorityFeePerGas).add(diff).toHexString();

            userOpGasPrice = minUserOpGasPrice;
        }
    }

    if (BigNumber.from(userOpGasPrice).lt(minGasPrice)) {
        const diff = BigNumber.from(minGasPrice).sub(userOpGasPrice);
        userOp.maxFeePerGas = BigNumber.from(userOp.maxFeePerGas).add(diff).toHexString();
        userOp.maxPriorityFeePerGas = BigNumber.from(userOp.maxPriorityFeePerGas).add(diff).toHexString();
    }

    return {
        maxFeePerGas: userOp.maxFeePerGas,
        maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
        gasCostInContract,
        gasCostWholeTransaction,
    };
}
