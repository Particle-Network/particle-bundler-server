import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { Http2Service } from './http2.service';

@Global()
@Module({
    imports: [
        HttpModule.register({
            headers: {
                'Content-Type': 'application/json',
            },
        }),
    ],
    providers: [Http2Service],
    exports: [Http2Service],
})
export class Http2Module {}
