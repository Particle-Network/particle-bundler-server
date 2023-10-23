import { IS_DEVELOPMENT } from '../common/common-types';
import { bundlerConfig, RPC_CONFIG as RPC_CONFIG_ARRAY } from './bundler-config';
import { cloneDeep } from 'lodash';

export const RPC_CONFIG: any = {};
for (const item of RPC_CONFIG_ARRAY) {
    RPC_CONFIG[String(item.chainId)] = item;
}

if (!IS_DEVELOPMENT) {
    delete RPC_CONFIG['1337'];
}

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
    ETHEREUM_MAINNET = 1,
    ETHEREUM_GOERLI_TESTNET = 5,
    ETHEREUM_SEPOLIA_TESTNET = 11155111,
    POLYGON_MAINNET = 137,
    POLYGON_TESTNET = 80001,
    BNB_MAINNET = 56,
    BNB_TESTNET = 97,
    OPBNB_MAINNET = 204,
    OPBNB_TESTNET = 5611,
    SCROLL_MAINNET = 534352,
    SCROLL_SEPOLIA = 534351,
    COMBO_TESTNET = 91715,
    LINEA_MAINNET = 59144,
    LINEA_TESTNET = 59140,
    OPTIMISM_MAINNET = 10,
    OPTIMISM_TESTNET = 420,
    BASE_MAINNET = 8453,
    BASE_TESTNET = 84531,
    MANTA_TESTNET = 3441005,
    MANTA_MAINNET = 169,
    MANTLE_TESTNET = 5001,
    MANTLE_MAINNET = 5000,
    ARBITRUM_ONE_MAINNET = 42161,
    ARBITRUM_NOVA_TESTNET = 42170,
    ARBITRUM_GOERLI_TESTNET = 421613,
    // POLYGON_ZKEVM_MAINNET = 1101,
    AVALANCHE_MAINNET = 43114,
    AVALANCHE_TESTNET = 43113,
    TAIKO_TESTNET = 167007,
    // Local node
    GETH = 1337,
}

export function getBundlerConfig(chainId: number) {
    const config = cloneDeep(bundlerConfig.default);
    if (bundlerConfig[chainId]) {
        Object.assign(config, bundlerConfig[chainId]);
    }

    return config;
}
