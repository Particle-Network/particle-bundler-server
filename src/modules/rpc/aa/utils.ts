import { isEmpty } from 'lodash';
import { BigNumber } from '../../../common/bignumber';
import { BytesLike, JsonRpcProvider, Network, hexlify } from 'ethers';
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

export function isUserOpValid(userOp: any, requireSignature: boolean = true, requireGasParams: boolean = true): boolean {
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

    if ([EVM_CHAIN_ID.COMBO_TESTNET, EVM_CHAIN_ID.OPBNB_MAINNET].includes(chainId)) {
        return {
            maxPriorityFeePerGas: 1001,
            maxFeePerGas: 1001,
            gasPrice: 1001,
            baseFee: Math.ceil(Number(particleFeeData?.baseFee ?? 0) * 10 ** 9),
        };
    }

    if (EVM_CHAIN_ID.TAIKO_TESTNET === chainId) {
        particleFeeData.baseFee = 0.000000001; // 1 wei
    }

    const result = {
        maxPriorityFeePerGas: Math.ceil(Number(particleFeeData?.[level]?.maxPriorityFeePerGas ?? 0) * 10 ** 9),
        maxFeePerGas: Math.ceil(Number(particleFeeData?.[level]?.maxFeePerGas ?? 0) * 10 ** 9),
        gasPrice: Math.ceil(Number(particleFeeData?.[level]?.maxFeePerGas ?? 0) * 10 ** 9),
        baseFee: Math.ceil(Number(particleFeeData?.baseFee ?? 0) * 10 ** 9),
    };

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

export function calcUserOpGasPrice(feeData: any, baseFee: number = 0): number {
    return Math.min(BigNumber.from(feeData.maxFeePerGas).toNumber(), BigNumber.from(feeData.maxPriorityFeePerGas).toNumber() + baseFee);
}

export function splitOriginNonce(originNonce: string) {
    const bn = BigNumber.from(originNonce);
    const key = bn.shr(64);

    let valueString = bn.toHexString();
    if (!key.eq(0)) {
        valueString = bn.shl(192).toHexString();
        valueString = `0x${valueString.slice(-48)}`;
    }

    return { nonceKey: key.toHexString(), nonceValue: BigNumber.from(valueString).toHexString() };
}
