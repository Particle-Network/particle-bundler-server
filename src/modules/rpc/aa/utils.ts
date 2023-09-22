import { isEmpty } from 'lodash';
import { BigNumber } from '../../../common/bignumber';
import { BytesLike, hexlify } from 'ethers';

export function calcUserOpTotalGasLimit(userOp: any): BigNumber {
    const gasLimitMul = isEmpty(userOp.paymasterAndData) || userOp.paymasterAndData === '0x' ? 1 : 3;
    return BigNumber.from(userOp.callGasLimit)
        .add(BigNumber.from(userOp.verificationGasLimit).mul(gasLimitMul))
        .add(BigNumber.from(userOp.preVerificationGas));
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
