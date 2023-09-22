import * as fs from 'fs';
import { getAddress } from 'ethers';
import { IS_DEVELOPMENT, IS_PRODUCTION } from '../common/common-types';

// read json file and get the object
const bundlerConfigName = IS_PRODUCTION ? 'bundler-config-production.json' : 'bundler-config.json';
const bundlerConfig = JSON.parse(Buffer.from(fs.readFileSync(`${__dirname}/../../${bundlerConfigName}`)).toString());

export const BUNDLER_CONFIG: any = bundlerConfig['BUNDLER_CONFIG'];
export const SUPPORTED_ENTRYPOINTS: string[] = bundlerConfig['SUPPORTED_ENTRYPOINTS'];
export const EVM_CHAIN_ID_NOT_SUPPORT_1559 = bundlerConfig['EVM_CHAIN_ID_NOT_SUPPORT_1559'];
export const BUNDLER_PRIVATE_KEYS = bundlerConfig['BUNDLER_PRIVATE_KEYS'];
export const VERIFYING_PAYMASTER_SIGNER = bundlerConfig['VERIFYING_PAYMASTER_SIGNER'];
export const PAYMENT_SIGNER = bundlerConfig['PAYMENT_SIGNER'];

export const RPC_CONFIG = bundlerConfig['RPC_CONFIG'];
if (!IS_DEVELOPMENT) {
    delete RPC_CONFIG['1337'];
}

export const MINIMUM_GAS_FEE = bundlerConfig['MINIMUM_GAS_FEE'];
export const CHAIN_SIGNER_MIN_BALANCE = bundlerConfig['CHAIN_SIGNER_MIN_BALANCE'];
export const CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT = bundlerConfig['CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT'];

export enum AA_METHODS {
    SEND_USER_OPERATION = 'eth_sendUserOperation',
    GET_USER_OPERATION_BY_HASH = 'eth_getUserOperationByHash',
    ESTIMATE_USER_OPERATION_GAS = 'eth_estimateUserOperationGas',
    GET_USER_OPERATION_RECEIPT = 'eth_getUserOperationReceipt',
    SUPPORTED_ENTRYPOINTS = 'eth_supportedEntryPoints',
    SPONSOR_USER_OPERATION = 'pm_sponsorUserOperation',
    USE_TOKEN_PAY_USER_OPERATION = 'pm_useTokenPayUserOperation',
    DEBUG_BUNDLER_CLEAR_STATE = 'debug_bundler_clearState',
    DEBUG_BUNDLER_DUMP_MEMPOOL = 'debug_bundler_dumpMempool',
    DEBUG_BUNDLER_SEND_BUNDLE_NOW = 'debug_bundler_sendBundleNow',
    DEBUG_BUNDLER_SET_BUNDLING_MODE = 'debug_bundler_setBundlingMode',
}

export enum EVM_CHAIN_ID {
    GOERLI_TESTNET = 5,
    SEPOLIA_TESTNET = 11155111,
    POLYGON_MAINNET = 137,
    POLYGON_TESTNET = 80001,
    BNB_MAINNET = 56,
    BNB_TESTNET = 97,
    OPBNB_MAINNET = 204,
    OPBNB_TESTNET = 5611,
    SCROLL_SEPOLIA = 534351,
    COMBO_TESTNET = 91715,
    LINEA_TESTNET = 59140,
    OPTIMISM_TESTNET = 420,
    // Local node
    GETH = 1337,
}

export function getPrivateKeyMap(chainId: number): any {
    const environment = process.env.ENVIRONMENT;

    const result = BUNDLER_PRIVATE_KEYS[environment];
    if (result[String(chainId)]) {
        return result[String(chainId)];
    }

    return result['default'];
}

export function getPrivateKeyByAddress(address: string): string {
    const environment = process.env.ENVIRONMENT;

    return BUNDLER_PRIVATE_KEYS[environment][getAddress(address)];
}
