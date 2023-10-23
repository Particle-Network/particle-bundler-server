import { isEmpty } from 'lodash';
import { BigNumber } from '../../../common/bignumber';
import { BytesLike, JsonRpcProvider, Network, hexlify } from 'ethers';
import { PARTICLE_PUBLIC_RPC_URL } from '../../../common/common-types';
import { EVM_CHAIN_ID } from '../../../configs/bundler-common';
import { EVM_CHAIN_ID_NOT_SUPPORT_1559, MINIMUM_GAS_FEE } from '../../../configs/bundler-config';

export function calcUserOpTotalGasLimit(userOp: any): BigNumber {
    const mul = 3;
    return BigNumber.from(userOp.callGasLimit)
        .add(BigNumber.from(userOp.verificationGasLimit))
        .mul(mul) // (callGasLimit + verificationGasLimit) * mul
        .add(BigNumber.from(userOp.preVerificationGas))
        .add(BigNumber.from(5000));
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
            console.log('key', key, userOp[key]);

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

export async function getFeeDataFromParticle(chainId: number) {
    const network = new Network('', chainId);
    const provider = new JsonRpcProvider(`${PARTICLE_PUBLIC_RPC_URL}?chainId=${chainId}`, network, {
        batchMaxCount: 1,
        staticNetwork: network,
    });

    if ([EVM_CHAIN_ID.COMBO_TESTNET, EVM_CHAIN_ID.OPBNB_MAINNET].includes(chainId)) {
        return {
            maxPriorityFeePerGas: 1001,
            maxFeePerGas: 1001,
            gasPrice: 1001,
        };
    }

    const particleFeeData = await provider.send('particle_suggestedGasFees', []);

    const result = {
        maxPriorityFeePerGas: Math.ceil(Number(particleFeeData?.high?.maxPriorityFeePerGas ?? 0) * 10 ** 9),
        maxFeePerGas: Math.ceil(Number(particleFeeData?.high?.maxFeePerGas ?? 0) * 10 ** 9),
        gasPrice: Math.ceil(Number(particleFeeData?.high?.maxFeePerGas ?? 0) * 10 ** 9),
    };

    if (EVM_CHAIN_ID_NOT_SUPPORT_1559.includes(chainId)) {
        result.maxPriorityFeePerGas = result.gasPrice;
        result.maxFeePerGas = result.gasPrice;
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
            }
        }
        if (MINIMUM_GAS_FEE[chainId]?.maxPriorityFeePerGas) {
            if (BigNumber.from(MINIMUM_GAS_FEE[chainId].maxPriorityFeePerGas).gt(result.maxPriorityFeePerGas)) {
                result.maxPriorityFeePerGas = BigNumber.from(MINIMUM_GAS_FEE[chainId].maxPriorityFeePerGas).toNumber();
            }
        }
    }

    return result;
}
