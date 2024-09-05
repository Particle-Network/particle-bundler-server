import * as dotenv from 'dotenv';
import { shuffle } from 'lodash';
import * as path from 'path';

let nodes: { [chainId: number]: string[] } = {};
if (process.env.USE_LOCAL_NODE) {
    const nodeConfig = dotenv.config({ path: path.resolve(process.cwd(), '.env.nodes') });
    if (nodeConfig.parsed) {
        for (const key in nodeConfig.parsed) {
            if (key.startsWith('EVM_CHAIN_RPC_URL_')) {
                const chainId = Number(key.replace('EVM_CHAIN_RPC_URL_', ''));
                nodes[chainId] = nodeConfig.parsed[key].split(',').filter((x) => !!x);
            }
        }
    }
}

export function getChainRpcUrls(chainId: number): string[] {
    return shuffle(nodes[chainId] || []);
}
