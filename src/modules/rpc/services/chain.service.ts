import { Injectable } from '@nestjs/common';
import { JsonRpcProvider, Network } from 'ethers';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';
import { CACHE_GAS_FEE_TIMEOUT, CACHE_TRANSACTION_COUNT_TIMEOUT, GAS_FEE_LEVEL } from '../../../common/common-types';
import { ConfigService } from '@nestjs/config';
import { LarkService } from '../../common/services/lark.service';
import P2PCache from '../../../common/p2p-cache';
import { RpcService } from './rpc.service';
import { PARTICLE_PUBLIC_RPC_URL, getBundlerChainConfig } from '../../../configs/bundler-common';
import { EVM_CHAIN_ID } from '../../../common/chains';
import Axios from 'axios';

export enum TRANSACTION_EXTRA_STATUS {
    NONE,
    NONCE_TOO_LOW,
}

@Injectable()
export class ChainService {
    public constructor(
        public readonly userOperationService: UserOperationService,
        public readonly transactionService: TransactionService,
        public readonly configService: ConfigService,
        public readonly rpcService: RpcService,
        public readonly larkService: LarkService,
    ) {}

    public async getTransactionReceipt(chainId: number, txHash: string) {
        const rpcUrl = getBundlerChainConfig(chainId).rpcUrl;
        const response = await Axios.post(
            rpcUrl,
            {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'eth_getTransactionReceipt',
                params: [txHash],
            },
            { timeout: 12000 },
        );

        return response.data?.result;
    }

    public async getFeeDataIfCache(chainId: number) {
        const cacheKey = this.keyCacheChainFeeData(chainId);
        let feeData = P2PCache.get(cacheKey);
        if (!!feeData) {
            return feeData;
        }

        feeData = await this.getFeeDataFromParticle(chainId, GAS_FEE_LEVEL.MEDIUM);
        P2PCache.set(cacheKey, feeData, CACHE_GAS_FEE_TIMEOUT);

        return feeData;
    }

    public async getFeeDataFromParticle(chainId: number, level: string = GAS_FEE_LEVEL.MEDIUM) {
        const network = Network.from(chainId);
        const provider = new JsonRpcProvider(`${PARTICLE_PUBLIC_RPC_URL}?chainId=${chainId}`, network, {
            batchMaxCount: 1,
            staticNetwork: network,
        });

        const particleFeeData = await provider.send('particle_suggestedGasFees', []);

        if (EVM_CHAIN_ID.TAIKO_TESTNET_HEKLA === chainId) {
            particleFeeData.baseFee = 0.000000001; // 1 wei
        }

        const result = {
            maxPriorityFeePerGas: Math.ceil(Number(particleFeeData?.[level]?.maxPriorityFeePerGas ?? 0) * 10 ** 9),
            maxFeePerGas: Math.ceil(Number(particleFeeData?.[level]?.maxFeePerGas ?? 0) * 10 ** 9),
            gasPrice: Math.ceil(Number(particleFeeData?.[level]?.maxFeePerGas ?? 0) * 10 ** 9),
            baseFee: Math.ceil(Number(particleFeeData?.baseFee ?? 0) * 10 ** 9),
        };

        if (chainId === EVM_CHAIN_ID.OPTIMISM_MAINNET && result.maxPriorityFeePerGas <= 0) {
            result.maxPriorityFeePerGas = 1;
        }

        const bundlerConfig = getBundlerChainConfig(chainId);
        if (
            !!bundlerConfig?.minGasFee?.maxPriorityFeePerGas &&
            result.maxPriorityFeePerGas < Number(bundlerConfig.minGasFee.maxPriorityFeePerGas)
        ) {
            result.maxPriorityFeePerGas = Number(bundlerConfig.minGasFee.maxPriorityFeePerGas);
        }
        if (!!bundlerConfig?.minGasFee?.maxFeePerGas && result.maxFeePerGas < Number(bundlerConfig.minGasFee.maxFeePerGas)) {
            result.maxFeePerGas = Number(bundlerConfig.minGasFee.maxFeePerGas);
        }
        if (!!bundlerConfig?.minGasFee?.gasPrice && result.gasPrice < Number(bundlerConfig.minGasFee.gasPrice)) {
            result.gasPrice = Number(bundlerConfig.minGasFee.gasPrice);
        }
        if (!!bundlerConfig?.minGasFee?.baseFee && result.baseFee < Number(bundlerConfig.minGasFee.baseFee)) {
            result.baseFee = Number(bundlerConfig.minGasFee.baseFee);
        }
        if (
            !!bundlerConfig?.maxGasFee?.maxPriorityFeePerGas &&
            result.maxPriorityFeePerGas > Number(bundlerConfig.maxGasFee.maxPriorityFeePerGas)
        ) {
            result.maxPriorityFeePerGas = Number(bundlerConfig.maxGasFee.maxPriorityFeePerGas);
        }
        if (!!bundlerConfig?.maxGasFee?.maxFeePerGas && result.maxFeePerGas > Number(bundlerConfig.maxGasFee.maxFeePerGas)) {
            result.maxFeePerGas = Number(bundlerConfig.maxGasFee.maxFeePerGas);
        }
        if (!!bundlerConfig?.maxGasFee?.gasPrice && result.gasPrice > Number(bundlerConfig.maxGasFee.gasPrice)) {
            result.gasPrice = Number(bundlerConfig.maxGasFee.gasPrice);
        }
        if (!!bundlerConfig?.maxGasFee?.baseFee && result.baseFee > Number(bundlerConfig.maxGasFee.baseFee)) {
            result.baseFee = Number(bundlerConfig.maxGasFee.baseFee);
        }

        return result;
    }

    private keyCacheChainFeeData(chainId: number): string {
        return `chain_fee_data:${chainId}`;
    }

    public async getTransactionCountIfCache(chainId: number, address: string, forceLatest: boolean = false): Promise<number> {
        try {
            const provider = this.rpcService.getJsonRpcProvider(chainId);
            const cacheKey = this.keyCacheChainSignerTransactionCount(chainId, address);
            let nonce = P2PCache.get(cacheKey);
            if (!forceLatest && !!nonce) {
                return nonce;
            }

            nonce = await provider.getTransactionCount(address, 'latest');
            P2PCache.set(cacheKey, nonce, CACHE_TRANSACTION_COUNT_TIMEOUT);

            return nonce;
        } catch (error) {
            return 0;
        }
    }

    public getTransactionCountWithCache(chainId: number, address: string): number {
        const cacheKey = this.keyCacheChainSignerTransactionCount(chainId, address);
        const nonce = P2PCache.get(cacheKey);

        return nonce ?? 0;
    }

    public trySetTransactionCountLocalCache(chainId: number, address: string, nonce: number) {
        const cacheKey = this.keyCacheChainSignerTransactionCount(chainId, address);
        const cachedNonce = P2PCache.get(cacheKey) ?? 0;
        if (nonce > cachedNonce) {
            P2PCache.set(cacheKey, nonce, CACHE_TRANSACTION_COUNT_TIMEOUT);
        }
    }

    private keyCacheChainSignerTransactionCount(chainId: number, address: string): string {
        return `chain_signer_transaction_count:${chainId}:${address.toLowerCase()}`;
    }
}
