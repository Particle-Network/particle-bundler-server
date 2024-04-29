import { isEmpty } from 'lodash';
import { AbiCoder, BigNumberish, BytesLike, JsonRpcProvider, Network, hexlify, keccak256, toBeHex } from 'ethers';
import { GAS_FEE_LEVEL } from '../../../common/common-types';
import { PARTICLE_PUBLIC_RPC_URL, getBundlerChainConfig } from '../../../configs/bundler-common';
import { TransactionFactory, TypedTransaction } from '@ethereumjs/tx';
import { AppException } from '../../../common/app-exception';
import { EVM_CHAIN_ID, SUPPORT_EIP_1559 } from '../../../common/chains';

// TODO need to test
export function calcUserOpTotalGasLimit(userOp: any, chainId: number): bigint {
    const mul = 3n;
    const g1 = BigInt(userOp.callGasLimit) + BigInt(userOp.verificationGasLimit) * mul + BigInt(userOp.preVerificationGas) + 5000n;

    let magicExtraGas = 1000000n;
    // HACK
    if (chainId === EVM_CHAIN_ID.MERLIN_CHAIN_MAINNET || chainId === EVM_CHAIN_ID.MERLIN_CHAIN_TESTNET) {
        magicExtraGas = 200000n;
    }
    const g2 = BigInt(userOp.callGasLimit) + BigInt(userOp.verificationGasLimit) + BigInt(userOp.preVerificationGas) + magicExtraGas;

    return g1 < g2 ? g1 : g2; // return min(g1, g2)
}

export function isUserOpValid(userOp: any, requireSignature = true, requireGasParams = true): boolean {
    if (isEmpty(userOp)) {
        return false;
    }

    const fields = ['sender', 'nonce', 'initCode', 'callData', 'paymasterAndData'];
    if (requireSignature) {
        fields.push('signature');
    }
    if (requireGasParams) {
        fields.push('preVerificationGas', 'verificationGasLimit', 'callGasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas');
    }

    for (const key of fields) {
        if (typeof userOp[key] !== 'string') {
            return false;
        }

        if (!userOp[key].startsWith('0x')) {
            return false;
        }
    }

    return true;
}

export function hexConcat(items: ReadonlyArray<BytesLike>): string {
    let result = '0x';
    items.forEach((item) => {
        result += hexlify(item).substring(2);
    });
    return result;
}

export function deepHexlify(obj: any): any {
    if (typeof obj === 'function') {
        return undefined;
    }
    if (obj == null || typeof obj === 'string' || typeof obj === 'boolean') {
        return obj;
    } else if (typeof obj === 'bigint' || typeof obj === 'number') {
        return toBeHex(obj);
    } else if (obj._isBigNumber !== null && obj.toHexString) {
        return obj.toHexString();
    } else if (typeof obj !== 'object') {
        return hexlify(obj).replace(/^0x0/, '0x');
    }
    if (Array.isArray(obj)) {
        return obj.map((member) => deepHexlify(member));
    }
    return Object.keys(obj).reduce(
        (set, key) => ({
            ...set,
            [key]: deepHexlify(obj[key]),
        }),
        {},
    );
}

export async function getFeeDataFromParticle(chainId: number, level: string = GAS_FEE_LEVEL.MEDIUM) {
    const network = Network.from(chainId);
    const provider = new JsonRpcProvider(`${PARTICLE_PUBLIC_RPC_URL}?chainId=${chainId}`, network, {
        batchMaxCount: 1,
        staticNetwork: network,
    });

    const particleFeeData = await provider.send('particle_suggestedGasFees', []);

    if (EVM_CHAIN_ID.TAIKO_TESTNET_KATLA === chainId) {
        particleFeeData.baseFee = 0.000000001; // 1 wei
    }

    const result = {
        maxPriorityFeePerGas: Math.ceil(Number(particleFeeData?.[level]?.maxPriorityFeePerGas ?? 0) * 10 ** 9),
        maxFeePerGas: Math.ceil(Number(particleFeeData?.[level]?.maxFeePerGas ?? 0) * 10 ** 9),
        gasPrice: Math.ceil(Number(particleFeeData?.[level]?.maxFeePerGas ?? 0) * 10 ** 9),
        baseFee: Math.ceil(Number(particleFeeData?.baseFee ?? 0) * 10 ** 9),
    };

    if (chainId === EVM_CHAIN_ID.OPTIMISM_MAINNET && result.maxPriorityFeePerGas <= 0) {
        result.maxPriorityFeePerGas = 1;
    }

    const bundlerConfig = getBundlerChainConfig(chainId);
    if (!!bundlerConfig?.minGasFee?.maxPriorityFeePerGas && result.maxPriorityFeePerGas < Number(bundlerConfig.minGasFee.maxPriorityFeePerGas)) {
        result.maxPriorityFeePerGas = Number(bundlerConfig.minGasFee.maxPriorityFeePerGas);
    }
    if (!!bundlerConfig?.minGasFee?.maxFeePerGas && result.maxFeePerGas < Number(bundlerConfig.minGasFee.maxFeePerGas)) {
        result.maxFeePerGas = Number(bundlerConfig.minGasFee.maxFeePerGas);
    }
    if (!!bundlerConfig?.minGasFee?.gasPrice && result.gasPrice < Number(bundlerConfig.minGasFee.gasPrice)) {
        result.gasPrice = Number(bundlerConfig.minGasFee.gasPrice);
    }
    if (!!bundlerConfig?.minGasFee?.baseFee && result.baseFee < Number(bundlerConfig.minGasFee.baseFee)) {
        result.baseFee = Number(bundlerConfig.minGasFee.baseFee);
    }
    if (!!bundlerConfig?.maxGasFee?.maxPriorityFeePerGas && result.maxPriorityFeePerGas > Number(bundlerConfig.maxGasFee.maxPriorityFeePerGas)) {
        result.maxPriorityFeePerGas = Number(bundlerConfig.maxGasFee.maxPriorityFeePerGas);
    }
    if (!!bundlerConfig?.maxGasFee?.maxFeePerGas && result.maxFeePerGas > Number(bundlerConfig.maxGasFee.maxFeePerGas)) {
        result.maxFeePerGas = Number(bundlerConfig.maxGasFee.maxFeePerGas);
    }
    if (!!bundlerConfig?.maxGasFee?.gasPrice && result.gasPrice > Number(bundlerConfig.maxGasFee.gasPrice)) {
        result.gasPrice = Number(bundlerConfig.maxGasFee.gasPrice);
    }
    if (!!bundlerConfig?.maxGasFee?.baseFee && result.baseFee > Number(bundlerConfig.maxGasFee.baseFee)) {
        result.baseFee = Number(bundlerConfig.maxGasFee.baseFee);
    }

    return result;
}

export function calcUserOpGasPrice(feeData: any, baseFee: number = 0): number {
    return Math.min(Number(BigInt(feeData.maxFeePerGas)), Number(BigInt(feeData.maxPriorityFeePerGas)) + baseFee);
}

export function splitOriginNonce(originNonce: string) {
    const bn = BigInt(originNonce);
    const key = bn >> 64n;
    let valueString = toBeHex(bn);
    if (key !== 0n) {
        valueString = valueString.slice(34);
        valueString = `0x${valueString}`;
    }

    return { nonceKey: toBeHex(key), nonceValue: toBeHex(valueString) };
}

export function getUserOpHash(chainId: number, userOp: any, entryPoint: string) {
    const abiCoder = new AbiCoder();

    const userOpHash = keccak256(packUserOp(userOp, true));
    const enc = abiCoder.encode(['bytes32', 'address', 'uint256'], [userOpHash, entryPoint, chainId]);
    return keccak256(enc);
}

export function packUserOp(userOp: any, forSignature = true): string {
    const abiCoder = new AbiCoder();
    if (forSignature) {
        return abiCoder.encode(
            ['address', 'uint256', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
            [
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                keccak256(userOp.paymasterAndData),
            ],
        );
    } else {
        // for the purpose of calculating gas cost encode also signature (and no keccak of bytes)
        return abiCoder.encode(
            ['address', 'uint256', 'bytes', 'bytes', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes', 'bytes'],
            [
                userOp.sender,
                userOp.nonce,
                userOp.initCode,
                userOp.callData,
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                userOp.paymasterAndData,
                userOp.signature,
            ],
        );
    }
}

export async function waitSeconds(seconds: number) {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export function tryParseSignedTx(signedTx: string): TypedTransaction {
    let tx: TypedTransaction;
    try {
        tx = TransactionFactory.fromSerializedData(Buffer.from(signedTx.substring(2), 'hex'));
    } catch (error) {
        throw new AppException(10002, `Invalid transaction: ${error.message}`);
    }

    return tx;
}

export function createTxGasData(chainId: number, feeData: any) {
    if (!SUPPORT_EIP_1559.includes(chainId)) {
        return {
            type: 0,
            gasPrice: feeData.gasPrice ?? 0,
        };
    }

    return {
        type: 2,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0,
        maxFeePerGas: feeData.maxFeePerGas ?? 0,
    };
}

export function toBeHexTrimZero(s: BigNumberish) {
    const result = toBeHex(s);
    if (result.startsWith('0x0')) {
        return `0x${result.slice(3)}`;
    }

    return result;
}
