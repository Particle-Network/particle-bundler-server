import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Helper } from '../../../common/helper';
import Axios from 'axios';
import * as Os from 'os';

@Injectable()
export class LarkService {
    private larkTitle = 'Particle Bundler Server';
    private readonly larkUrl: string;

    public constructor(private readonly configService: ConfigService) {
        this.larkUrl = this.configService.get('LARK_URL');
    }

    public setLarkTitle(larkTitle: string) {
        this.larkTitle = larkTitle;
    }

    public async sendMessage(content: string, title?: string): Promise<any> {
        const titleWithEnv = `${Os.hostname()} | ${this.larkTitle} | ${title ?? ''} | ${process.env.ENVIRONMENT}`;

        try {
            const chunk = Helper.chunkString(content, 2000);
            for (let index = 0; index < chunk.length; index++) {
                const chunkContent = chunk[index];
                await Axios.post(this.larkUrl, Helper.createLarkBody(chunkContent, `${titleWithEnv} #${index + 1}`));
            }
        } catch (error) {
            // do nothing
        }
    }
}
