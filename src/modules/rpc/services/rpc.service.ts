import { Injectable } from '@nestjs/common';
import { $enum } from 'ts-enum-util';
import Axios from 'axios';
import { EVM_CHAIN_ID, RPC_CONFIG } from '../../../configs/bundler-config';
import { JsonRPCRequestDto, JsonRPCResponse } from './../dtos/json-rpc-request.dto';
import { AppException } from '../../../common/app-exception';
import * as AA from './../aa';
import * as DEBUG from './../debug';
import { AAService } from './aa.service';
import { JsonRpcProvider, Network } from 'ethers';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { Http2Service } from '../../../http2/http2.service';
import { AA_METHODS } from '../../../configs/bundler-config';
import { IS_DEVELOPMENT, PARTICLE_PUBLIC_RPC_URL } from '../../../common/common-types';

@Injectable()
export class RpcService {
    private readonly jsonRpcProviders: Map<number, JsonRpcProvider> = new Map();

    public constructor(
        public readonly aaService: AAService,
        public readonly http2Service: Http2Service,
        public readonly redisService: RedisService,
    ) {}

    public getJsonRpcProvider(chainId: number): JsonRpcProvider {
        if (!this.jsonRpcProviders.has(chainId)) {
            const rpcUrl = RPC_CONFIG[chainId].rpcUrl;
            const network = new Network('', chainId);
            const provider = new JsonRpcProvider(rpcUrl, network, { batchMaxCount: 1, staticNetwork: network });
            this.jsonRpcProviders.set(chainId, provider);
        }

        return this.jsonRpcProviders.get(chainId);
    }

    public async handle(chainId: number, body: JsonRPCRequestDto) {
        if (!$enum(AA_METHODS).isValue(body.method as string)) {
            const rpcUrl = RPC_CONFIG[chainId].rpcUrl;
            const response = await Axios.post(rpcUrl, body);
            return response.data;
        }

        if (body.method.startsWith('eth_')) {
            const method = body.method.slice(4);
            if (AA[method]) {
                const result = await AA[method](this, chainId, body);
                return JsonRPCResponse.createSuccessResponse(body, result);
            }
        }

        if (body.method.startsWith('debug_') && IS_DEVELOPMENT) {
            const method = body.method.slice(6);
            if (DEBUG[method]) {
                const result = await DEBUG[method](this, chainId, body);
                return JsonRPCResponse.createSuccessResponse(body, result);
            }
        }

        if (body.method.startsWith('pm_')) {
            const method = body.method.slice(3);
            if (AA[method]) {
                const result = await AA[method](this, chainId, body);
                return JsonRPCResponse.createSuccessResponse(body, result);
            }
        }

        throw new AppException(-32000);
    }

    public async getTransactionReceipt(provider: JsonRpcProvider, txHash: string) {
        return await provider.send('eth_getTransactionReceipt', [txHash]);
    }

    public async getFeeData(chainId: number) {
        const network = new Network('', chainId);
        const provider = new JsonRpcProvider(`${PARTICLE_PUBLIC_RPC_URL}?chainId=${chainId}`, network, {
            batchMaxCount: 1,
            staticNetwork: network,
        });

        if ([EVM_CHAIN_ID.COMBO_TESTNET, EVM_CHAIN_ID.OPBNB_MAINNET].includes(chainId)) {
            return {
                maxPriorityFeePerGas: 1001,
                maxFeePerGas: 1001,
                gasPrice: 1001,
            };
        }

        const particleFeeData = await provider.send('particle_suggestedGasFees', []);

        return {
            maxPriorityFeePerGas: Math.ceil(Number(particleFeeData?.high?.maxPriorityFeePerGas ?? 0) * 10 ** 9),
            maxFeePerGas: Math.ceil(Number(particleFeeData?.high?.maxFeePerGas ?? 0) * 10 ** 9),
            gasPrice: Math.ceil(Number(particleFeeData?.high?.maxFeePerGas ?? 0) * 10 ** 9),
        };
    }
}
