import { Controller, Get, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { FastifyReply } from 'fastify';
import { Connection as MongoConnection } from 'mongoose';

@Controller()
export class CommonController {
    public constructor(@InjectConnection() private mongoConnection: MongoConnection) {}

    @Get('status')
    public async getStatus(@Res() res: FastifyReply): Promise<any> {
        const result = {
            mongodb: this.mongoConnection.readyState === 1 ? 200 : 500,
        };

        return res.status((<any>Object).values(result).includes(500) ? 500 : 200).send(result);
    }
}
