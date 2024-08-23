import { Controller, Get, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Connection } from 'typeorm';

@Controller()
export class CommonController {
    public constructor(private readonly connection: Connection) {}

    @Get('status')
    public async getStatus(@Res() res: FastifyReply): Promise<any> {
        const result = {
            db: await this.connection
                .query('SELECT VERSION()')
                .then(() => 200)
                .catch(() => 500),
        };

        return res.status((<any>Object).values(result).includes(500) ? 500 : 200).send(result);
    }
}
