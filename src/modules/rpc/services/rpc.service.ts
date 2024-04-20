import { Injectable } from '@nestjs/common';
import { $enum } from 'ts-enum-util';
import Axios from 'axios';
import { PARTICLE_PAYMASTER_URL, RPC_CONFIG } from '../../../configs/bundler-common';
import { JsonRPCRequestDto, JsonRPCResponse } from './../dtos/json-rpc-request.dto';
import { AppException } from '../../../common/app-exception';
import * as AA from './../aa';
import * as DEBUG from './../debug';
import { AAService } from './aa.service';
import { FetchRequest, JsonRpcProvider, Network } from 'ethers';
import { AA_METHODS } from '../../../configs/bundler-common';
import { IS_DEVELOPMENT, PROVIDER_FETCH_TIMEOUT } from '../../../common/common-types';

@Injectable()
export class RpcService {
    private readonly jsonRpcProviders: Map<number, JsonRpcProvider> = new Map();
    private readonly cachedValidPaymasters: Map<number, string> = new Map();

    public constructor(public readonly aaService: AAService) {}

    public getJsonRpcProvider(chainId: number): JsonRpcProvider {
        if (!this.jsonRpcProviders.has(chainId)) {
            const rpcUrl = RPC_CONFIG[chainId].rpcUrl;
            const network = new Network('', chainId);
            const fetchRequest = new FetchRequest(rpcUrl);
            fetchRequest.timeout = PROVIDER_FETCH_TIMEOUT;
            const provider = new JsonRpcProvider(fetchRequest, network, { batchMaxCount: 1, staticNetwork: network });
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

        if (body.method.startsWith('bundler_')) {
            const method = body.method.slice(8);
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

    public async getValidPaymasterAddress(chainId: number) {
        if (this.cachedValidPaymasters.has(chainId)) {
            return this.cachedValidPaymasters.get(chainId);
        }

        try {
            const r = await Axios.post(
                PARTICLE_PAYMASTER_URL,
                {
                    method: 'pm_paymaster',
                    params: [],
                },
                { params: { chainId } },
            );

            if (r?.data?.result) {
                this.cachedValidPaymasters.set(chainId, r.data.result);

                return r.data.result;
            }
        } catch (error) {
            // nothing
        }

        return null;
    }
}
