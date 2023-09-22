import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { AppException } from '../common/app-exception';
import { Helper } from '../common/helper';
import { IS_PARTICLE } from '../common/common-types';

@Injectable()
export class Http2Service {
    public constructor(private readonly configService: ConfigService, private readonly httpService: HttpService) {}

    private larkTitle = 'Particle Network Exception Notice';

    public setLarkTitle(title: string) {
        this.larkTitle = title;
    }

    public getHttp(): AxiosInstance {
        return this.httpService.axiosRef as any;
    }

    /**
     * @TODO
     * Error should return as JSON RPC 2.0 style
     */

    public async sendChainRpc(url: string, rpcBody: object) {
        const rpcBodyString = JSON.stringify(rpcBody);

        try {
            const response = await this.httpService.axiosRef.post(url, rpcBodyString, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            });

            return response.data;
        } catch (error) {
            if (!!error?.response?.data) {
                return error.response.data;
            }

            this.sendLarkMessage(`Send Chain RPC Error: ${url}\n ${rpcBodyString}\n ${error.message}`);

            throw new AppException(10001);
        }
    }

    public async sendLarkMessage(content: string, title?: string): Promise<any> {
        if (!IS_PARTICLE) {
            return;
        }

        const larkNoticeUrl = this.configService.get('LARK_NOTICE_URL');

        const titleWithEnv = `${this.larkTitle} | ${title ?? ''} | ${this.configService.get('ENVIRONMENT')}`;

        if (!!larkNoticeUrl) {
            try {
                const chunk = Helper.chunkString(content, 2000);
                for (let index = 0; index < chunk.length; index++) {
                    const chunkContent = chunk[index];
                    await this.httpService.axiosRef.post(
                        this.configService.get('LARK_NOTICE_URL'),
                        Helper.createLarkBody(chunkContent, `${titleWithEnv} #${index + 1}`),
                    );
                }
            } catch (error) {
                // do nothing
            }
        }
    }
}
