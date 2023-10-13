export const RPC_CONFIG = [
    {
        chainId: 11155111,
        rpcUrl: 'https://rpc-debug.particle.network/evm-chain/public?chainId=11155111',
    },
];

export const bundlerConfig: any = {
    default: {
        MAX_BUNDLE_GAS: 7000000,
        SUPPORTED_ENTRYPOINTS: [
            '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
        ],
    },
    '534351': {
        MAX_BUNDLE_GAS: 5000000,
    },
};

export const EVM_CHAIN_ID_NOT_SUPPORT_1559 = [];

export const MINIMUM_GAS_FEE = {
    '11155111': { gasPrice: '0x5f5e100' },
};
export const CHAIN_BALANCE_RANGE = {
    '11155111': 0.1,
};
export const CHAIN_SIGNER_MIN_BALANCE = {
    '11155111': 0.1,
};
export const CHAIN_VERIFYING_PAYMASTER_MIN_DEPOSIT = {
    '11155111': 0.1,
};
