import { isEmpty } from 'lodash';
import { BigNumber } from '../../../common/bignumber';
import { AbiCoder, BytesLike, JsonRpcProvider, Network, hexlify, keccak256 } from 'ethers';
import { GAS_FEE_LEVEL } from '../../../common/common-types';
import { EVM_CHAIN_ID, MINIMUM_GAS_FEE, PARTICLE_PUBLIC_RPC_URL } from '../../../configs/bundler-common';

export function calcUserOpTotalGasLimit(userOp: any): BigNumber {
    const mul = 3;
    const g1 = BigNumber.from(userOp.callGasLimit)
        .add(BigNumber.from(userOp.verificationGasLimit))
        .mul(mul) // (callGasLimit + verificationGasLimit) * mul
        .add(BigNumber.from(userOp.preVerificationGas))
        .add(BigNumber.from(5000));

    const g2 = BigNumber.from(userOp.callGasLimit)
        .add(BigNumber.from(userOp.verificationGasLimit))
        .add(BigNumber.from(userOp.preVerificationGas))
        .add(BigNumber.from(1000000));

    return BigNumber.from(g1.lt(g2) ? g1 : g2); // return min(g1, g2)
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
        return BigNumber.from(obj).toHexString();
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
    const network = new Network('', chainId);
    const provider = new JsonRpcProvider(`${PARTICLE_PUBLIC_RPC_URL}?chainId=${chainId}`, network, {
        batchMaxCount: 1,
        staticNetwork: network,
    });

    const particleFeeData = await provider.send('particle_suggestedGasFees', []);

    if ([EVM_CHAIN_ID.COMBO_MAINNET, EVM_CHAIN_ID.COMBO_TESTNET, EVM_CHAIN_ID.OPBNB_MAINNET, EVM_CHAIN_ID.OPBNB_TESTNET].includes(chainId)) {
        return {
            maxPriorityFeePerGas: 1001,
            maxFeePerGas: 1001,
            gasPrice: 1001,
            baseFee: Math.ceil(Number(particleFeeData?.baseFee ?? 0) * 10 ** 9),
        };
    }

    if ([EVM_CHAIN_ID.MERLIN_CHAIN_TESTNET].includes(chainId)) {
        return {
            maxPriorityFeePerGas: 100000000,
            maxFeePerGas: 100000000,
            gasPrice: 100000000,
            baseFee: 0,
        };
    }

    if ([EVM_CHAIN_ID.BEVM_TESTNET].includes(chainId)) {
        return {
            maxPriorityFeePerGas: 50000000,
            maxFeePerGas: 50000000,
            gasPrice: 50000000,
            baseFee: 0,
        };
    }

    if ([EVM_CHAIN_ID.BSQUARED_TESTNET].includes(chainId)) {
        return {
            maxPriorityFeePerGas: 10000000,
            maxFeePerGas: 10000000,
            gasPrice: 10000000,
            baseFee: 0,
        };
    }

    if (EVM_CHAIN_ID.TAIKO_TESTNET === chainId || EVM_CHAIN_ID.TAIKO_TESTNET_KATLA === chainId) {
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

    if (MINIMUM_GAS_FEE[chainId]) {
        if (MINIMUM_GAS_FEE[chainId]?.gasPrice) {
            if (BigNumber.from(MINIMUM_GAS_FEE[chainId].gasPrice).gt(result.gasPrice)) {
                result.gasPrice = BigNumber.from(MINIMUM_GAS_FEE[chainId].gasPrice).toNumber();
            }
        }
        if (MINIMUM_GAS_FEE[chainId]?.maxFeePerGas) {
            if (BigNumber.from(MINIMUM_GAS_FEE[chainId].maxFeePerGas).gt(result.maxFeePerGas)) {
                result.maxFeePerGas = BigNumber.from(MINIMUM_GAS_FEE[chainId].maxFeePerGas).toNumber();
                result.maxPriorityFeePerGas = result.maxFeePerGas;
            }
        }
    }

    return result;
}

export function calcUserOpGasPrice(feeData: any, baseFee = 0): number {
    return Math.min(BigNumber.from(feeData.maxFeePerGas).toNumber(), BigNumber.from(feeData.maxPriorityFeePerGas).toNumber() + baseFee);
}

export function splitOriginNonce(originNonce: string) {
    const bn = BigNumber.from(originNonce);
    const key = bn.shr(64);

    let valueString = bn.toHexString();
    if (!key.eq(0)) {
        valueString = valueString.slice(34);
        valueString = `0x${valueString}`;
    }

    return { nonceKey: key.toHexString(), nonceValue: BigNumber.from(valueString).toHexString() };
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
