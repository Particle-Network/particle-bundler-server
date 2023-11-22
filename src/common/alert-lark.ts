import Axios from 'axios';
import { Helper } from './helper';
import { IAlert } from './alert';

export class AlertLarkService implements IAlert {
    public constructor(private readonly larkUrl: string) {}

    private larkTitle = 'Particle Bundler Server';

    public setLarkTitle(title: string) {
        this.larkTitle = title;
    }

    public async sendMessage(content: string, title?: string): Promise<any> {
        const titleWithEnv = `${Date.now()} | ${this.larkTitle} | ${title ?? ''} | ${process.env.ENVIRONMENT}`;

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
