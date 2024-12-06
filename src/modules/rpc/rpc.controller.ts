import { Controller, Post, Query, Req, Res } from '@nestjs/common';
import { RpcService } from './services/rpc.service';
import { JsonRPCRequestDto, JsonRPCResponse } from './dtos/json-rpc-request.dto';
import { FastifyReply } from 'fastify';
import { isArray, isPlainObject } from 'lodash';
import { Helper } from '../../common/helper';
import { AppException } from '../../common/app-exception';
import { IS_PRODUCTION } from '../../common/common-types';
import { LarkService } from '../common/services/lark.service';
import { EVM_CHAIN_ID } from '../../common/chains';
import { ConfigService } from '@nestjs/config';
import { $enum } from 'ts-enum-util';

@Controller()
export class RpcController {
    private readonly basicAuthUsername: string;
    private readonly basicAuthPassword: string;

    public constructor(
        private readonly configService: ConfigService,
        private readonly rpcService: RpcService,
        private readonly larkService: LarkService,
    ) {
        this.basicAuthUsername = this.configService.get('BASIC_AUTH_USERNAME');
        this.basicAuthPassword = this.configService.get('BASIC_AUTH_PASSWORD');
    }

    @Post()
    public async rpc(@Query() query: any, @Req() req: any, @Res() res: FastifyReply): Promise<any> {
        this._rpc(query, req, res);
    }

    @Post('rpc')
    public async _rpc(@Query() query: any, @Req() req: any, @Res() res: FastifyReply): Promise<any> {
        let result: any;
        let body: any;

        try {
            const isAuth = this.verifyBasicAuth(req);
            body = req.body ?? JSON.parse(req.rawBody);
            body.isAuth = isAuth;
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

            Helper.assertTrue(chainId !== EVM_CHAIN_ID.SEI_MAINNET, -32001, `Unsupported chainId: ${chainId}`);
            Helper.assertTrue($enum(EVM_CHAIN_ID).isValue(chainId), -32001, `Unsupported chainId: ${chainId}`);

            result = await this.handleRpc(chainId, body);
        } catch (error) {
            if (!IS_PRODUCTION && !(error instanceof AppException)) {
                console.error(error);
            }

            result = JsonRPCResponse.createErrorResponse(body, error);
        }

        res.status(200).send(result);
    }

    private verifyBasicAuth(req: any): boolean {
        const authorization = req?.headers?.authorization;
        if (!authorization) {
            return false;
        }

        const base64Auth = (authorization ?? '').split(' ')[1] ?? '';
        const [username, password] = Buffer.from(base64Auth, 'base64').toString().split(':');

        return username === this.basicAuthUsername && password === this.basicAuthPassword;
    }

    public async handleRpc(chainId: number, body: any) {
        try {
            if (isPlainObject(body)) {
                return await this.handlePlainBody(chainId, body);
            }

            if (isArray(body)) {
                const promises = body.map((item) => this.handlePlainBody(chainId, item));
                return await Promise.all(promises);
            }

            throw new AppException(-32600);
        } catch (error) {
            if (!IS_PRODUCTION) {
                console.error(error);
            }

            if (!(error instanceof AppException) || error.errorCode === -32000) {
                if (error?.errno === -104 && error?.code === 'ECONNRESET' && error?.syscall === 'read') {
                    // ignore
                    // may be the client close the connection
                } else {
                    const errorMessage = Helper.converErrorToString(error);
                    if (errorMessage.includes('socket hang up')) {
                        // ignore
                    } else {
                        this.larkService.sendMessage(`Bundler RPC Error\nChainId: ${chainId}\nBody:${JSON.stringify(body)}\n${errorMessage}`);
                    }
                }
            }

            return JsonRPCResponse.createErrorResponse(body, error);
        }
    }

    private async handlePlainBody(chainId: number, body: any) {
        body = await JsonRPCRequestDto.fromPlainAndCheck(body);

        return await this.rpcService.handle(chainId, body);
    }
}
