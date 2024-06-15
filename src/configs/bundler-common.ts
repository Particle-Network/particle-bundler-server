import { BundlerConfig, IBundlerChainConfig } from '../common/common-types';
import { cloneDeep } from 'lodash';
import * as Fs from 'fs';

export let BUNDLER_CONFIG_MAP: BundlerConfig;
export let PARTICLE_PAYMASTER_URL: string;
export let PARTICLE_PUBLIC_RPC_URL: string;
export let FORBIDDEN_PAYMASTER: string[] = [];
export let PAYMASTER_CHECK: string[] = [];

export async function initializeBundlerConfig() {
    let bc: any;
    const exists = Fs.existsSync(`${__dirname}/bundler-config-particle.js`) || Fs.existsSync(`${__dirname}/bundler-config-particle.ts`);
    if (exists) {
        bc = await import('./bundler-config-particle' as any);
    } else {
        bc = await import('./bundler-config');
    }

    BUNDLER_CONFIG_MAP = bc.exportBundlerConfig();
    PARTICLE_PAYMASTER_URL = bc.PARTICLE_PAYMASTER_URL;
    PARTICLE_PUBLIC_RPC_URL = bc.PARTICLE_PUBLIC_RPC_URL;

    if (bc.FORBIDDEN_PAYMASTER) {
        FORBIDDEN_PAYMASTER = bc.FORBIDDEN_PAYMASTER;
    }

    if (bc.PAYMASTER_CHECK) {
        PAYMASTER_CHECK = bc.PAYMASTER_CHECK;
    }
}

export function getBundlerChainConfig(chainId: number): IBundlerChainConfig {
    const config = cloneDeep(BUNDLER_CONFIG_MAP.default);
    if (BUNDLER_CONFIG_MAP[chainId]) {
        Object.assign(config, BUNDLER_CONFIG_MAP[chainId]);
    }

    return config;
}

export const DEFAULT_ENTRY_POINT_ADDRESS = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
export const ENTRY_POINT_VERSION_MAP = {
    v06: ['0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'],
};

export enum AA_METHODS {
    SEND_USER_OPERATION = 'eth_sendUserOperation',
    GET_USER_OPERATION_BY_HASH = 'eth_getUserOperationByHash',
    ESTIMATE_USER_OPERATION_GAS = 'eth_estimateUserOperationGas',
    GET_USER_OPERATION_RECEIPT = 'eth_getUserOperationReceipt',
    SUPPORTED_ENTRYPOINTS = 'eth_supportedEntryPoints',
    PEINDING_COUND = 'bundler_pendingUserOpCount',
}
