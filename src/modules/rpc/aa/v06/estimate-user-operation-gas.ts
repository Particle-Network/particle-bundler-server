import { AbiCoder, JsonRpcProvider, getAddress, isHexString } from 'ethers';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import { Logger } from '@nestjs/common';
import { hexConcat } from '@ethersproject/bytes';
import { RpcService } from '../../services/rpc.service';
import { Helper } from '../../../../common/helper';
import { calcUserOpGasPrice, isUserOpValid, toBeHexTrimZero } from '../utils';
import { AppException } from '../../../../common/app-exception';
import { JsonRPCRequestDto } from '../../dtos/json-rpc-request.dto';
import { DUMMY_SIGNATURE } from '../../../../common/common-types';
import { getL2ExtraFee, simulateHandleOpAndGetGasCost } from './send-user-operation';
import { EVM_CHAIN_ID, L2_GAS_ORACLE, SUPPORT_EIP_1559, USE_PROXY_CONTRACT_TO_ESTIMATE_GAS } from '../../../../common/chains';
import { deserializeUserOpCalldata } from '../deserialize-user-op';

export async function estimateUserOperationGas(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, 'Invalid params: userop must be an object');

    const userOp = body.params[0];
    const entryPoint = getAddress(body.params[1]);

    // Init default value
    userOp.maxFeePerGas = '0x01';
    userOp.maxPriorityFeePerGas = '0x01';
    userOp.verificationGasLimit = toBeHexTrimZero(1000000);
    userOp.callGasLimit = toBeHexTrimZero(10000000);
    userOp.preVerificationGas = '0x00';

    const paymasterAddress = await rpcService.getValidPaymasterAddress(chainId);
    if (!userOp.paymasterAndData || userOp.paymasterAndData === '0x') {
        // paymaster dummy signature
        const abiCoder = AbiCoder.defaultAbiCoder();
        userOp.paymasterAndData = hexConcat([paymasterAddress, abiCoder.encode(['uint48', 'uint48'], ['0x0', '0x0']), DUMMY_SIGNATURE]);
    }

    if (!userOp.signature || userOp.signature === '0x') {
        userOp.signature = DUMMY_SIGNATURE;
    }

    Helper.assertTrue(isHexString(userOp.paymasterAndData), -32602, 'Invalid params: paymasterAndData must be hex string');
    Helper.assertTrue(isHexString(userOp.signature), -32602, 'Invalid params: signature must be hex string');

    userOp.preVerificationGas = toBeHexTrimZero(calcPreVerificationGas(userOp) + 5000);
    Helper.assertTrue(isUserOpValid(userOp), -32602, 'Invalid userOp');

    const provider = rpcService.getJsonRpcProvider(chainId);
    const [{ callGasLimit, initGas }, { maxFeePerGas, maxPriorityFeePerGas, gasCostInContract, gasCostWholeTransaction, verificationGasLimit }] =
        await Promise.all([
            estimateGasLimit(provider, entryPoint, userOp),
            calculateGasPrice(rpcService, chainId, userOp, entryPoint),
            tryEstimateGasForFirstAccount(provider, userOp),
        ]);

    userOp.preVerificationGas = toBeHexTrimZero(calcPreVerificationGas(userOp) + 5000);
    userOp.verificationGasLimit = verificationGasLimit;
    userOp.callGasLimit = toBeHexTrimZero(callGasLimit);
    userOp.maxFeePerGas = maxFeePerGas;
    userOp.maxPriorityFeePerGas = maxPriorityFeePerGas;

    if (initGas > 0n && gasCostInContract > initGas) {
        userOp.callGasLimit = toBeHexTrimZero(gasCostInContract - initGas);
    }

    if (
        USE_PROXY_CONTRACT_TO_ESTIMATE_GAS.includes(chainId) &&
        gasCostWholeTransaction - gasCostInContract > BigInt(userOp.preVerificationGas)
    ) {
        userOp.preVerificationGas = toBeHexTrimZero(gasCostWholeTransaction - gasCostInContract);
    }

    // For mantle, because the gas estimation is including L1 extra fee, so we can not use it directly
    // TODO recheck ARBITRUM
    if ([EVM_CHAIN_ID.MANTLE_MAINNET, EVM_CHAIN_ID.MANTLE_SEPOLIA_TESTNET].includes(chainId)) {
        userOp.callGasLimit = toBeHexTrimZero(gasCostInContract);
        userOp.preVerificationGas = toBeHexTrimZero(gasCostWholeTransaction * (initGas > 0n ? 2n : 1n));
    }

    Helper.assertTrue(BigInt(userOp.maxFeePerGas) > 0n, -32602, 'maxFeePerGas must be larger than 0 during gas estimation');

    try {
        return {
            gasCostWholeTransaction: toBeHexTrimZero(gasCostWholeTransaction),
            maxFeePerGas: toBeHexTrimZero(userOp.maxFeePerGas),
            maxPriorityFeePerGas: toBeHexTrimZero(userOp.maxPriorityFeePerGas),
            preVerificationGas: toBeHexTrimZero(userOp.preVerificationGas),
            verificationGasLimit: toBeHexTrimZero(userOp.verificationGasLimit),
            callGasLimit: toBeHexTrimZero(userOp.callGasLimit),
        };
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

        // It happens in contract call, so we can ignore the init gas
        if (initGas > 21000n) {
            initGas -= 21000n;
        }

        if (callGasLimit > 21000n) {
            callGasLimit -= 21000n;
        }
    } catch (error) {
        throw new AppException(-32005, `Estimate gas failed: ${error?.shortMessage ?? error?.message}`);
    }

    return { callGasLimit, initGas };
}

async function tryEstimateGasForFirstAccount(provider: JsonRpcProvider, userOp: any) {
    if (userOp.initCode?.length <= 2) {
        return;
    }

    const txs = deserializeUserOpCalldata(userOp.callData);
    // If there are more than 1 txs, there may be some context that we can not estimate gas directly
    // TODO use multicall3 to estimate gas
    if (txs.length > 1) {
        return;
    }

    try {
        await Promise.all(
            txs.map((tx) => {
                return provider.estimateGas({
                    from: userOp.sender,
                    to: tx.to,
                    data: tx.data,
                    value: tx.value,
                });
            }),
        );
    } catch (error) {
        throw new AppException(-32005, `Estimate gas failed: ${error?.shortMessage ?? error?.message}`);
    }
}

async function calculateGasPrice(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    const [rSimulation, userOpFeeData, extraFee] = await Promise.all([
        simulateHandleOpAndGetGasCost(rpcService, chainId, userOp, entryPoint),
        rpcService.aaService.getFeeData(chainId),
        getL2ExtraFee(rpcService, chainId, userOp, entryPoint),
    ]);

    const gasCostInContract = BigInt(rSimulation.gasCostInContract);
    const gasCostWholeTransaction = BigInt(rSimulation.gasCostWholeTransaction);
    const gasCost = USE_PROXY_CONTRACT_TO_ESTIMATE_GAS.includes(chainId)
        ? gasCostWholeTransaction > gasCostInContract
            ? gasCostWholeTransaction
            : gasCostInContract
        : gasCostInContract;

    userOp.maxFeePerGas = SUPPORT_EIP_1559.includes(chainId)
        ? toBeHexTrimZero(userOpFeeData.maxFeePerGas)
        : toBeHexTrimZero(userOpFeeData.gasPrice);
    userOp.maxPriorityFeePerGas = SUPPORT_EIP_1559.includes(chainId)
        ? toBeHexTrimZero(userOpFeeData.maxPriorityFeePerGas)
        : toBeHexTrimZero(userOpFeeData.gasPrice);

    const userOpGasPrice = calcUserOpGasPrice(userOp, userOpFeeData.baseFee);

    const signerFeeData = userOpFeeData;
    const signerGasPrice = SUPPORT_EIP_1559.includes(chainId)
        ? calcUserOpGasPrice(signerFeeData, signerFeeData.baseFee)
        : signerFeeData.gasPrice;

    let minGasPrice = (BigInt(signerGasPrice) * 105n) / 100n;
    if (Object.keys(L2_GAS_ORACLE).includes(String(chainId))) {
        const signerPaid = gasCost + 5000n * BigInt(signerGasPrice);
        minGasPrice = (BigInt(extraFee) + signerPaid) / gasCost;
    }

    if (
        [
            EVM_CHAIN_ID.POLYGON_MAINNET,
            EVM_CHAIN_ID.POLYGON_AMOY_TESTNET,
            EVM_CHAIN_ID.BASE_MAINNET,
            EVM_CHAIN_ID.BASE_TESTNET_SEPOLIA,
            EVM_CHAIN_ID.PGN_MAINNET,
            EVM_CHAIN_ID.PGN_TESTNET,
            EVM_CHAIN_ID.MANTA_MAINNET,
            EVM_CHAIN_ID.MANTA_TESTNET,
            EVM_CHAIN_ID.OPTIMISM_MAINNET,
            EVM_CHAIN_ID.OPTIMISM_TESTNET_SEPOLIA,
            EVM_CHAIN_ID.MANTLE_MAINNET,
            EVM_CHAIN_ID.MANTLE_SEPOLIA_TESTNET,
            EVM_CHAIN_ID.SCROLL_MAINNET,
            EVM_CHAIN_ID.SCROLL_SEPOLIA,
            EVM_CHAIN_ID.OPBNB_MAINNET,
            EVM_CHAIN_ID.OPBNB_TESTNET,
            EVM_CHAIN_ID.COMBO_MAINNET,
            EVM_CHAIN_ID.COMBO_TESTNET,
            EVM_CHAIN_ID.MODE_MAINNET,
            EVM_CHAIN_ID.MODE_TESTNET,
            EVM_CHAIN_ID.BLAST_MAINNET,
            EVM_CHAIN_ID.BLAST_TESTNET_SEPOLIA,
            EVM_CHAIN_ID.ANCIENT8_MAINNET,
            EVM_CHAIN_ID.ANCIENT8_TESTNET,
            EVM_CHAIN_ID.XTERIO_MAINNET,
            EVM_CHAIN_ID.XTERIO_TESTNET,
            EVM_CHAIN_ID.XTERIO_ETH_MAINNET,
            EVM_CHAIN_ID.GMNETWORK_TESTNET,
            EVM_CHAIN_ID.AINN_TESTNET,
            EVM_CHAIN_ID.ASTAR_ZKEVM_MAINNET,
            EVM_CHAIN_ID.ASTAR_ZKEVM_TESTNET_ZKYOTO,
            EVM_CHAIN_ID.IMMUTABLE_ZKEVM_MAINNET,
            EVM_CHAIN_ID.IMMUTABLE_ZKEVM_TESTNET,
            EVM_CHAIN_ID.BOB_MAINNET,
            EVM_CHAIN_ID.BOB_TESTNET,
            EVM_CHAIN_ID.PEQA_KREST_MAINNET,
            EVM_CHAIN_ID.PEQA_AGUNG_TESTNET,
            EVM_CHAIN_ID.CYBER_MAINNET,
            EVM_CHAIN_ID.CYBER_TESTNET,
        ].includes(chainId)
    ) {
        let ratio = 1.05;
        if ([EVM_CHAIN_ID.MANTLE_MAINNET, EVM_CHAIN_ID.MANTLE_SEPOLIA_TESTNET].includes(chainId)) {
            ratio = 1.6;
        }
        if ([EVM_CHAIN_ID.OPTIMISM_TESTNET_SEPOLIA, EVM_CHAIN_ID.BLAST_TESTNET_SEPOLIA, EVM_CHAIN_ID.BASE_TESTNET_SEPOLIA].includes(chainId)) {
            ratio = 2;
        }

        minGasPrice = (minGasPrice * BigInt(Math.round(ratio * 100))) / 100n;
    }

    if (BigInt(userOpGasPrice) < minGasPrice) {
        const diff = minGasPrice - BigInt(userOpGasPrice);
        userOp.maxFeePerGas = toBeHexTrimZero(BigInt(userOp.maxFeePerGas) + diff);
        userOp.maxPriorityFeePerGas = toBeHexTrimZero(BigInt(userOp.maxPriorityFeePerGas) + diff);
    }

    return {
        maxFeePerGas: userOp.maxFeePerGas,
        maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
        verificationGasLimit: rSimulation.verificationGasLimit,
        gasCostInContract,
        gasCostWholeTransaction,
    };
}
