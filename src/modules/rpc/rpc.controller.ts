import { Controller, Post, Query, Req, Res } from '@nestjs/common';
import { RpcService } from './services/rpc.service';
import { JsonRPCRequestDto, JsonRPCResponse } from './dtos/json-rpc-request.dto';
import { FastifyReply } from 'fastify';
import { isArray, isPlainObject } from 'lodash';
import { Helper } from '../../common/helper';
import { RPC_CONFIG } from '../../configs/bundler-config';
import { AppException } from '../../common/app-exception';
import { Http2Service } from '../../http2/http2.service';

@Controller()
export class RpcController {
    public constructor(private readonly rpcService: RpcService, private readonly http2Service: Http2Service) {}

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
            const chainId = Number(query.chainId);
            Helper.assertTrue(!!RPC_CONFIG[chainId], -32001, `Unsupported chainId: ${query.chainId}`);

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
                this.http2Service.sendLarkMessage(`Bundler RPC Error: ${Helper.converErrorToString(error)}`);
            }

            return JsonRPCResponse.createErrorResponse(body, error);
        }
    }

    private async handlePlainBody(chainId: number, body: any) {
        body = await JsonRPCRequestDto.fromPlainAndCheck(body);

        return await this.rpcService.handle(chainId, body);
    }
}
