import { isEmpty, random } from 'lodash';
import { AbiCoder, BigNumberish, BytesLike, getBytes, hexlify, keccak256, toBeHex, ZeroAddress, zeroPadValue } from 'ethers';
import { IS_DEBUG, IS_DEVELOPMENT, PRODUCTION_HOSTNAME } from '../../../common/common-types';
import { TransactionFactory, TypedTransaction } from '@ethereumjs/tx';
import { AppException } from '../../../common/app-exception';
import { EVM_CHAIN_ID, L2_GAS_ORACLE, SUPPORT_EIP_1559 } from '../../../common/chains';
import * as Os from 'os';
import { RpcService } from '../services/rpc.service';
import { entryPointAbis } from './abis/entry-point-abis';
import l1GasPriceOracleAbi from './abis/l1-gas-price-oracle-abi';
import { PROCESS_HANDLE_CHAINS } from '../../../configs/bundler-common';

// TODO need to test
export function calcUserOpTotalGasLimit(userOp: any, chainId: number): bigint {
    // v0.7
    if (!!userOp.accountGasLimits) {
        const { verificationGasLimit, callGasLimit } = unpackAccountGasLimits(userOp.accountGasLimits);
        let packedPaymasterGasLimit = 0n;
        let postOpGasLimit = 0n;
        if (userOp.paymasterAndData.length > 2) {
            packedPaymasterGasLimit = BigInt(`0x${userOp.paymasterAndData.substring(42, 74)}`);
            postOpGasLimit = BigInt(`0x${userOp.paymasterAndData.substring(74, 106)}`);
        }

        return 21000n + verificationGasLimit + callGasLimit + BigInt(userOp.preVerificationGas) + packedPaymasterGasLimit + postOpGasLimit;
    }

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

export function isUserOpValidV06(userOp: any, requireSignature = true, requireGasParams = true): boolean {
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

export function isUserOpValidV07(userOp: any, requireSignature = true, requireGasParams = true): boolean {
    if (isEmpty(userOp)) {
        return false;
    }

    const fields = ['sender', 'nonce', 'initCode', 'callData', 'paymasterAndData'];
    if (requireSignature) {
        fields.push('signature');
    }
    if (requireGasParams) {
        fields.push('preVerificationGas', 'gasFees', 'accountGasLimits');
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
        return toBeHexTrimZero(obj);
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

export function calcUserOpGasPrice(feeData: any, baseFee: number = 0): number {
    return Math.min(Number(BigInt(feeData.maxFeePerGas)), Number(BigInt(feeData.maxPriorityFeePerGas)) + baseFee);
}

export function splitOriginNonce(originNonce: string) {
    if (originNonce.length > 66) {
        throw new AppException(10002, 'Invalid origin nonce');
    }

    originNonce = `0x${originNonce.slice(2).padStart(64, '0')}`;
    const bn = BigInt(originNonce);
    const key = bn >> 64n;
    let valueString = toBeHex(bn);
    if (key !== 0n) {
        valueString = originNonce.slice(50);
        valueString = `0x${valueString}`;
    }

    return { nonceKey: toBeHex(key), nonceValue: toBeHex(valueString) };
}

export function getUserOpHashV06(chainId: number, userOp: any, entryPoint: string) {
    const userOpHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(
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
        ),
    );
    const enc = AbiCoder.defaultAbiCoder().encode(['bytes32', 'address', 'uint256'], [userOpHash, entryPoint, chainId]);
    return keccak256(enc);
}

export function getUserOpHashV07(chainId: number, userOp: any, entryPoint: string): string {
    const userOpHash = keccak256(encodeUserOpV07(userOp, true));
    const enc = AbiCoder.defaultAbiCoder().encode(['bytes32', 'address', 'uint256'], [userOpHash, entryPoint, chainId]);
    return keccak256(enc);
}

export function encodeUserOpV07(op: any, forSignature = true): string {
    if (forSignature) {
        return AbiCoder.defaultAbiCoder().encode(
            ['address', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'bytes32'],
            [
                op.sender,
                op.nonce,
                keccak256(op.initCode),
                keccak256(op.callData),
                op.accountGasLimits,
                op.preVerificationGas,
                op.gasFees,
                keccak256(op.paymasterAndData),
            ],
        );
    } else {
        // for the purpose of calculating gas cost encode also signature (and no keccak of bytes)
        return AbiCoder.defaultAbiCoder().encode(
            ['address', 'uint256', 'bytes', 'bytes', 'bytes32', 'uint256', 'bytes32', 'bytes', 'bytes'],
            [
                op.sender,
                op.nonce,
                op.initCode,
                op.callData,
                op.accountGasLimits,
                op.preVerificationGas,
                op.gasFees,
                op.paymasterAndData,
                op.signature,
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

export function parsePaymasterAndDataAndGetExpiredAt(paymasterAndData: string): number {
    const [expiredAt] = AbiCoder.defaultAbiCoder().decode(['uint48', 'uint48'], `0x${paymasterAndData.slice(42, 170)}`);

    return Number(expiredAt);
}

export function canRunCron() {
    if (!!process.env.DISABLE_TASK) {
        return false;
    }

    if (IS_DEVELOPMENT) {
        return true;
    }

    if (IS_DEBUG) {
        return true;
    }

    // IS_PRODUCTION
    return Os.hostname() === PRODUCTION_HOSTNAME;
}

export function packAccountGasLimits(validationGasLimit: string | bigint | number, callGasLimit: string | bigint | number): string {
    return packUint(validationGasLimit, callGasLimit);
}

export function unpackAccountGasLimits(accountGasLimits: string | bigint): {
    verificationGasLimit: bigint;
    callGasLimit: bigint;
} {
    const [verificationGasLimit, callGasLimit] = unpackUint(accountGasLimits);
    return {
        verificationGasLimit,
        callGasLimit,
    };
}

export async function getL2ExtraFee(rpcService: RpcService, chainId: number, userOp: any, entryPoint: string) {
    if (!Object.keys(L2_GAS_ORACLE).includes(String(chainId))) {
        return '0x00';
    }

    const entryPointVersion = rpcService.getVersionByEntryPoint(entryPoint);
    const contractEntryPoint = rpcService.getSetCachedContract(entryPoint, entryPointAbis[entryPointVersion]);
    const l1GasPriceOracleContract = rpcService.getSetCachedContract(L2_GAS_ORACLE[chainId], l1GasPriceOracleAbi);

    const fakeSigner = rpcService.signerService.getChainSigners(chainId)[0];
    const simulateTx = await contractEntryPoint.handleOps.populateTransaction([userOp], fakeSigner.address);
    simulateTx.from = fakeSigner.address;

    const rawTransaction = await fakeSigner.signTransaction(simulateTx);

    const callTx = await l1GasPriceOracleContract.getL1Fee.populateTransaction(rawTransaction);
    const rl2ExtraFee = await rpcService.chainService.staticCall(chainId, callTx);

    return toBeHex(rl2ExtraFee.result);
}

export function packUint(high128: BigNumberish, low128: BigNumberish): string {
    return zeroPadValue(toBeHex((BigInt(high128) << 128n) + BigInt(low128)), 32);
}

export function unpackUint(packed: string | bigint): [high128: bigint, low128: bigint] {
    const bnPacked = BigInt(packed);
    return [bnPacked >> 128n, bnPacked & ((1n << 128n) - 1n)];
}

export function packPaymasterData(
    paymaster: string,
    paymasterVerificationGasLimit: BigNumberish,
    postOpGasLimit: BigNumberish,
    paymasterData?: BytesLike,
): BytesLike {
    return hexConcat([paymaster, packUint(paymasterVerificationGasLimit, postOpGasLimit), paymasterData ?? '0x']);
}

export const DefaultGasOverheads = {
    fixed: 21000,
    perUserOp: 18300,
    perUserOpWord: 4,
    zeroByte: 4,
    nonZeroByte: 16,
    bundleSize: 1,
    sigSize: 65,
};

export function calcPreVerificationGasV07(userOp: any): number {
    const ov = { ...DefaultGasOverheads };
    const p = {
        // dummy values, in case the UserOp is incomplete.
        preVerificationGas: 21000, // dummy value, just for calldata cost
        signature: hexlify(Buffer.alloc(ov.sigSize, 1)), // dummy signature
        ...userOp,
    } as any;

    const packed = getBytes(encodeUserOpV07(p, false));
    const lengthInWord = (packed.length + 31) / 32;
    const callDataCost = packed.map((x) => (x === 0 ? ov.zeroByte : ov.nonZeroByte)).reduce((sum, x) => sum + x);
    const ret = Math.round(callDataCost + ov.fixed / ov.bundleSize + ov.perUserOp + ov.perUserOpWord * lengthInWord);
    return ret;
}

export function createUniqId(): number {
    if (IS_DEVELOPMENT) {
        return Date.now() * 1000 + random(0, 999);
    }

    return Date.now() * 1000 + Number(process.env.NODE_APP_INSTANCE) * 100 + random(0, 99);
}

export function getSupportChainIdCurrentProcess(): number[] {
    if (IS_DEVELOPMENT) {
        return PROCESS_HANDLE_CHAINS[0];
    }

    return PROCESS_HANDLE_CHAINS[Number(process.env.NODE_APP_INSTANCE)];
}

export function isSolanaChain(chainId: number) {
    return [101, 102, 103].includes(chainId);
}
