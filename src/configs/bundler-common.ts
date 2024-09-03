import { BundlerConfig, IBundlerChainConfig } from '../common/common-types';
import { cloneDeep, merge } from 'lodash';
import * as Fs from 'fs';
import { getChainRpcUrls } from './nodes.config';

export let BUNDLER_CONFIG_MAP: BundlerConfig;
export let PARTICLE_PAYMASTER_URL: string;
export let PARTICLE_PUBLIC_RPC_URL: string;
export let FORBIDDEN_PAYMASTER: string[] = [];
export let PAYMASTER_CHECK: string[] = [];
export let PROCESS_HANDLE_CHAINS: number[][] = [];
export let onEmitUserOpEvent = (userOperationHash: string, event: any) => {};
export let onCreateUserOpTxHash = (userOperationHash: string, txHash: string) => {};

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
    PROCESS_HANDLE_CHAINS = bc.PROCESS_HANDLE_CHAINS;

    if (bc.FORBIDDEN_PAYMASTER) {
        FORBIDDEN_PAYMASTER = bc.FORBIDDEN_PAYMASTER;
    }

    if (bc.PAYMASTER_CHECK) {
        PAYMASTER_CHECK = bc.PAYMASTER_CHECK;
    }

    if (bc.onEmitUserOpEvent) {
        onEmitUserOpEvent = bc.onEmitUserOpEvent;
    }

    if (bc.onCreateUserOpTxHash) {
        onCreateUserOpTxHash = bc.onCreateUserOpTxHash;
    }
}

export function getBundlerChainConfig(chainId: number): IBundlerChainConfig {
    const config = cloneDeep(BUNDLER_CONFIG_MAP.default);
    if (BUNDLER_CONFIG_MAP[chainId]) {
        const rpcUrls = getChainRpcUrls(chainId);
        merge(config, BUNDLER_CONFIG_MAP[chainId], { rpcUrl: rpcUrls[0] });
    }

    return config;
}

export const ENTRY_POINT_ADDRESS_V06 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
export const ENTRY_POINT_ADDRESS_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

export const ENTRY_POINT_VERSION_MAP = {
    v06: [ENTRY_POINT_ADDRESS_V06],
    v07: [ENTRY_POINT_ADDRESS_V07],
};

export const ALL_SUPPORTED_ENTRY_POINTS = Object.values(ENTRY_POINT_VERSION_MAP).flat();

export enum AA_METHODS {
    SEND_USER_OPERATION = 'eth_sendUserOperation',
    SEND_USER_OPERATION_BATCH = 'eth_sendUserOperationBatch',
    GET_USER_OPERATION_BY_HASH = 'eth_getUserOperationByHash',
    ESTIMATE_USER_OPERATION_GAS = 'eth_estimateUserOperationGas',
    GET_USER_OPERATION_RECEIPT = 'eth_getUserOperationReceipt',
    SUPPORTED_ENTRYPOINTS = 'eth_supportedEntryPoints',
    PEINDING_COUND = 'bundler_pendingUserOpCount',
}
