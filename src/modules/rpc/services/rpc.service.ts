import { Injectable } from '@nestjs/common';
import { $enum } from 'ts-enum-util';
import Axios from 'axios';
import { EVM_CHAIN_ID, RPC_CONFIG } from '../../../configs/bundler-common';
import { JsonRPCRequestDto, JsonRPCResponse } from './../dtos/json-rpc-request.dto';
import { AppException } from '../../../common/app-exception';
import * as AA from './../aa';
import * as DEBUG from './../debug';
import { AAService } from './aa.service';
import { JsonRpcProvider, Network } from 'ethers';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { AA_METHODS } from '../../../configs/bundler-common';
import { IS_DEVELOPMENT } from '../../../common/common-types';

@Injectable()
export class RpcService {
    private readonly jsonRpcProviders: Map<number, JsonRpcProvider> = new Map();

    public constructor(
        public readonly aaService: AAService,
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
}
