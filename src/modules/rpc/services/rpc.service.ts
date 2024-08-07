import { Injectable } from '@nestjs/common';
import { $enum } from 'ts-enum-util';
import Axios from 'axios';
import { ENTRY_POINT_VERSION_MAP, PARTICLE_PAYMASTER_URL, getBundlerChainConfig } from '../../../configs/bundler-common';
import { JsonRPCRequestDto, JsonRPCResponse } from './../dtos/json-rpc-request.dto';
import { AppException } from '../../../common/app-exception';
import * as AA from './../aa';
import { Contract, getAddress, isAddress } from 'ethers';
import { AA_METHODS } from '../../../configs/bundler-common';
import { Helper } from '../../../common/helper';
import { LarkService } from '../../common/services/lark.service';
import { SignerService } from './signer.service';
import { ChainService } from './chain.service';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';

@Injectable()
export class RpcService {
    private readonly cachedContract: Map<string, Contract> = new Map();
    private readonly cachedValidPaymasters: Map<number, string> = new Map();

    public constructor(
        public readonly signerService: SignerService,
        public readonly larkService: LarkService,
        public readonly chainService: ChainService,
        public readonly userOperationService: UserOperationService,
        public readonly transactionService: TransactionService,
    ) {}

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

    public async handle(chainId: number, body: JsonRPCRequestDto) {
        if (!$enum(AA_METHODS).isValue(body.method as string)) {
            const rpcUrl = getBundlerChainConfig(chainId).rpcUrl;
            const response = await Axios.post(rpcUrl, body);
            return response.data;
        }

        let method: string;
        if (body.method.startsWith('eth_')) {
            method = body.method.slice(4);
        }

        if (body.method.startsWith('bundler_')) {
            method = body.method.slice(8);
        }

        let result: any;
        if (
            [AA_METHODS.ESTIMATE_USER_OPERATION_GAS, AA_METHODS.SEND_USER_OPERATION, AA_METHODS.SEND_USER_OPERATION_BATCH].includes(
                body.method as AA_METHODS,
            )
        ) {
            Helper.assertTrue(
                typeof body.params[1] === 'string' && isAddress(body.params[1]),
                -32602,
                'Invalid params: entry point must be an address',
            );

            const version: string = this.getVersionByEntryPoint(body.params[1]);
            result = await AA[version][method](this, chainId, body);
        } else {
            result = await AA[method](this, chainId, body);
        }

        return JsonRPCResponse.createSuccessResponse(body, result);
    }

    public getVersionByEntryPoint(entryPoint: string) {
        entryPoint = getAddress(entryPoint);

        const supportedVersions = Object.keys(ENTRY_POINT_VERSION_MAP);
        for (const supportedVersion of supportedVersions) {
            for (const supportedEntryPoints of ENTRY_POINT_VERSION_MAP[supportedVersion]) {
                if (supportedEntryPoints.includes(entryPoint)) {
                    return supportedVersion;
                }
            }
        }

        throw new AppException(-32603);
    }

    public getSetCachedContract(address: string, abi: any): Contract {
        if (!this.cachedContract.has(address)) {
            this.cachedContract.set(address, new Contract(address, abi));
        }

        return this.cachedContract.get(address);
    }
}
