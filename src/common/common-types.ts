export const IS_DEVELOPMENT = process.env.ENVIRONMENT === 'dev';
export const IS_DEBUG = process.env.ENVIRONMENT === 'debug';
export const IS_PRODUCTION = process.env.ENVIRONMENT === 'production';
export const SUPPORT_GAELESS_PAYMASTER = process.env.SUPPORT_GAELESS_PAYMASTER === '1';
export const USE_MONOGODB_TRANSACTION = process.env.USE_MONOGODB_TRANSACTION === '1';

export const BUNDLE_LIMIT: number = 100;

export const REDIS_TASK_CONNECTION_NAME = 'bundler_task';
export const keyEventSendUserOperation = 'bundler:event:send_user_operation';
export const PENDING_TRANSACTION_WAITING_TIME = 60;
export const PENDING_TRANSACTION_SIGNER_HANDLE_LIMIT = 10;
export const PARTICLE_PUBLIC_RPC_URL = 'https://rpc.particle.network/evm-chain/public';

export enum BUNDLING_MODE {
    MANUAL,
    AUTO,
}

export function keyLockPendingTransaction(id: string) {
    return `bundler:lock:pending_transaction:${id}`;
}

export function keyLockSendingTransaction(signedTx: string) {
    return `bundler:lock:sending_transaction:${signedTx}`;
}

export function keyLockSigner(chainId: number, signer: string) {
    return `bundler:lock:signer:${chainId}:${signer}`;
}

export function keyLockChainId(chainId: any) {
    return `bundler:lock:chainId:${chainId}`;
}

// UserOperationEvent Topic
export const EVENT_ENTRY_POINT_USER_OPERATION = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';
