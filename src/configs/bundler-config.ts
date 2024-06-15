import { $enum } from 'ts-enum-util';
import { EVM_CHAIN_ID } from '../common/chains';
import { BundlerConfig } from '../common/common-types';

export const FORBIDDEN_PAYMASTER = [];
export const PAYMASTER_CHECK = [];
export const PARTICLE_PAYMASTER_URL = 'https://paymaster.particle.network';
export const PARTICLE_PUBLIC_RPC_URL = 'https://rpc.particle.network/evm-chain/public';

export function exportBundlerConfig(): BundlerConfig {
    const config: BundlerConfig = {
        default: {
            maxBundleGas: 7000000,
            signerBalanceRange: 0.1, // ether
            methodSendRawTransaction: 'particle_sendRawTransactionV2', // particle method
            pendingTransactionSignerHandleLimit: 10,
            maxUserOpPackCount: 10,
            canIncrGasPriceRetry: true,
            canIncrGasPriceRetryMaxCount: 5,
            userOperationLocalPoolMaxCount: 500,
            mevCheck: false,
        },
    };

    const chains = $enum(EVM_CHAIN_ID).values();
    for (const chainId of chains) {
        // Default RPC
        const rpcUrl = `${PARTICLE_PUBLIC_RPC_URL}?chainId=${chainId}`;

        if (!config[chainId]) {
            config[chainId] = {};
        }

        if (!config[chainId]?.rpcUrl) {
            config[chainId].rpcUrl = rpcUrl;
        }
    }

    return config;
}
