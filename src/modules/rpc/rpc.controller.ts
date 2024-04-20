import { Controller, Post, Query, Req, Res } from '@nestjs/common';
import { RpcService } from './services/rpc.service';
import { JsonRPCRequestDto, JsonRPCResponse } from './dtos/json-rpc-request.dto';
import { FastifyReply } from 'fastify';
import { isArray, isPlainObject } from 'lodash';
import { Helper } from '../../common/helper';
import { EVM_CHAIN_ID, RPC_CONFIG } from '../../configs/bundler-common';
import { AppException } from '../../common/app-exception';
import { Alert } from '../../common/alert';
import { IS_PRODUCTION } from '../../common/common-types';

@Controller()
export class RpcController {
    public constructor(private readonly rpcService: RpcService) {}

    @Post('')
    public async rpc(@Query() query: any, @Req() req: any, @Res() res: FastifyReply): Promise<any> {
        this._rpc(query, req, res);
    }

    @Post('rpc')
    public async _rpc(@Query() query: any, @Req() req: any, @Res() res: FastifyReply): Promise<any> {
        let result: any;
        let body: any;

        try {
            body = JSON.parse(req.rawBody);
            let chainId: number;
            if (!!query.chainId) {
                chainId = Number(query.chainId);
            } else {
                if (isArray(body)) {
                    Helper.assertTrue(typeof body?.[0]?.chainId === 'number', 10002);
                    chainId = body[0].chainId;
                } else {
                    Helper.assertTrue(typeof body?.chainId === 'number', 10002);
                    chainId = body.chainId;
                }
            }

            Helper.assertTrue(!!RPC_CONFIG[chainId], -32001, `Unsupported chainId: ${chainId}`);
            Helper.assertTrue(!IS_PRODUCTION || chainId !== EVM_CHAIN_ID.PARTICLE_PANGU_TESTNET, -32001, `Unsupported chainId: ${chainId}`);

            result = await this.handleRpc(chainId, body);
        } catch (error) {
            console.error(error);

            result = JsonRPCResponse.createErrorResponse(body, error);
        }

        res.status(200).send(result);
    }

    public async handleRpc(chainId: number, body: any) {
        try {
            if (isPlainObject(body)) {
                return await this.handlePlainBody(chainId, body);
            }

            if (isArray(body)) {
                // Simple handle
                const promises = body.map((item) => this.handlePlainBody(chainId, item));
                return await Promise.all(promises);
            }

            throw new AppException(-32600);
        } catch (error) {
            console.error(error);

            if (!(error instanceof AppException) || error.errorCode === -32000) {
                Alert.sendMessage(`Bundler RPC Error\nChainId: ${chainId}\nBody:${JSON.stringify(body)}\n${Helper.converErrorToString(error)}`);
            }

            return JsonRPCResponse.createErrorResponse(body, error);
        }
    }

    private async handlePlainBody(chainId: number, body: any) {
        body = await JsonRPCRequestDto.fromPlainAndCheck(body);

        return await this.rpcService.handle(chainId, body);
    }
}
