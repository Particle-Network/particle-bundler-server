export const IS_DEVELOPMENT = process.env.ENVIRONMENT === 'dev' || !process.env.ENVIRONMENT;
export const IS_DEBUG = process.env.ENVIRONMENT === 'debug';
export const IS_PRODUCTION = process.env.ENVIRONMENT === 'production';
export const USE_MONOGODB_TRANSACTION = () => process.env.USE_MONOGODB_TRANSACTION === '1';

export const BUNDLE_LIMIT: number = 100;

export const REDIS_TASK_CONNECTION_NAME = 'bundler_task';
export const keyEventSendUserOperation = 'bundler:event:send_user_operation';
export const PENDING_TRANSACTION_WAITING_TIME = 60;
export const PENDING_TRANSACTION_SIGNER_HANDLE_LIMIT = 10;
export const PARTICLE_PUBLIC_RPC_URL = 'https://rpc-debug.particle.network/evm-chain/public';

export enum BLOCK_SIGNER_REASON {
    UNKNOWN,
    INSUFFICIENT_BALANCE,
}

export enum BUNDLING_MODE {
    MANUAL,
    AUTO,
}

export enum GAS_FEE_LEVEL {
    MEDIUM = 'medium',
    HIGH = 'high',
}

export function keyLockPendingTransaction(id: string) {
    return `bundler:lock:pending_transaction:${id}`;
}

export function keyLockSendingTransaction(chainId: number, signedTx: string) {
    return `bundler:lock:sending_transaction:${chainId}:${signedTx}`;
}

export function keyLockSigner(chainId: number, signer: string) {
    return `bundler:lock:signer:${chainId}:${signer}`;
}

export function keyLockChainId(chainId: any) {
    return `bundler:lock:chainId:${chainId}`;
}

// UserOperationEvent Topic
export const EVENT_ENTRY_POINT_USER_OPERATION = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';

export const DUMMY_SIGNATURE =
    '0x3054659b5e29460a8f3ac9afc3d5fcbe4b76f92aed454b944e9b29e55d80fde807716530b739540e95cfa4880d69f710a9d45910f2951a227675dc1fb0fdf2c71c';

export const MULTI_CALL_3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
