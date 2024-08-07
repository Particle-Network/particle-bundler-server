import { Wallet } from 'ethers';
import { UserOperationEntity } from '../modules/rpc/entities/user-operation.entity';

export const IS_DEVELOPMENT = process.env.ENVIRONMENT === 'dev' || !process.env.ENVIRONMENT;
export const IS_DEBUG = process.env.ENVIRONMENT === 'debug';
export const IS_PRODUCTION = process.env.ENVIRONMENT === 'production';
export const PRODUCTION_HOSTNAME = 'particle-bundler-server-handler';

export const BUNDLE_LIMIT = 100;

export const PROVIDER_FETCH_TIMEOUT = 12000; // 12s
export const PENDING_TRANSACTION_WAITING_TIME = 60;
export const PENDING_TRANSACTION_EXPIRED_TIME = 600; // 10 mins
export const PENDING_TRANSACTION_ABANDON_TIME = 1800; // 30 mins
export const PENDING_TRANSACTION_SIGNER_HANDLE_LIMIT = 10;
export const CACHE_GAS_FEE_TIMEOUT = 10000; // 10s
export const CACHE_TRANSACTION_COUNT_TIMEOUT = 600000; // 600s
export const CACHE_TRANSACTION_RECEIPT_TIMEOUT = 10000; // 10s
export const CACHE_USEROPHASH_TXHASH_TIMEOUT = 10000; // 10s
export const SERVER_NAME = 'particle-bundler-server';
export const MULTI_CALL_3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

export type BundlerConfig = {
    [key: string]: IBundlerChainConfig;
};

export interface IBundlerChainConfig {
    maxBundleGas?: number;
    signerBalanceRange?: number;
    minSignerBalance?: number;
    pendingTransactionSignerHandleLimit?: number;
    maxUserOpPackCount?: number;
    mevCheck?: boolean;
    canIncrGasPriceRetry?: boolean;
    canIncrGasPriceRetryMaxCount?: number;
    userOperationLocalPoolMaxCount?: number;
    sendRawTransactionRpcUrl?: string;
    callGasLimitBase?: bigint;
    verificationGasLimitBase?: bigint;
    maxPickSignerOnceCount?: number;
    minGasFee?: {
        gasPrice?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
        baseFee?: string;
    };
    maxGasFee?: {
        gasPrice?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
        baseFee?: string;
    };
    rpcUrl?: string;
    methodSendRawTransaction?: string;
    wsUrl?: string;
}

export enum BLOCK_SIGNER_REASON {
    UNKNOWN,
    INSUFFICIENT_BALANCE,
}

export enum GAS_FEE_LEVEL {
    MEDIUM = 'medium',
    HIGH = 'high', // Not used
}

export enum PROCESS_EVENT_TYPE {
    CREATE_USER_OPERATION = 'create_user_operation',
    GET_GAS_FEE = 'get_gas_fee',
    GET_TRANSACTION_COUNT = 'get_transaction_count',
    SET_RECEIPT = 'set_receipt',
}

export function keyCacheChainFeeData(chainId: number): string {
    return `chain_fee_data:${chainId}`;
}

export function keyCacheChainSignerTransactionCount(chainId: number, address: string): string {
    return `chain_signer_transaction_count:${chainId}:${address.toLowerCase()}`;
}

export function keyCacheChainReceipt(transactionId: string): string {
    return `chain_receipt:${transactionId}`;
}

export function keyCacheChainUserOpHashReceipt(userOpHash: string): string {
    return `chain_userophash_receipt:${userOpHash}`;
}

export function keyCacheChainUserOpHashTxHash(userOpHash: string): string {
    return `chain_userophash_txHash:${userOpHash}`;
}

export function keyLockPendingTransaction(id: any) {
    return `bundler:lock:pending_transaction:${id}`;
}

export function keyLockSendingTransaction(id: number) {
    return `bundler:lock:sending_transaction:${id}`;
}

export function keyLockSigner(chainId: number, signer: string) {
    return `bundler:lock:signer:${chainId}:${signer.toLowerCase()}`;
}

// UserOperationEvent Topic
export const EVENT_ENTRY_POINT_USER_OPERATION = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';

export const DUMMY_SIGNATURE =
    '0x3054659b5e29460a8f3ac9afc3d5fcbe4b76f92aed454b944e9b29e55d80fde807716530b739540e95cfa4880d69f710a9d45910f2951a227675dc1fb0fdf2c71c';

export interface IUserOperationEventObject {
    chainId: number;
    blockHash: string;
    blockNumber: number;
    userOperationHash: string;
    txHash: string;
    contractAddress: string;
    topic: string;
    args: any;
}

export interface SignerWithPendingTxCount {
    signer: Wallet;
    availableTxCount: number;
}

export interface IPackedBundle {
    signer: Wallet;
    address: string;
    bundles: IBundle[];
}

export interface IBundle {
    entryPoint: string;
    userOperations: UserOperationEntity[];
    gasLimit: string;
}
