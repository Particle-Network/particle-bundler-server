import { Module } from '@nestjs/common';
import { CommonController } from './common.controller';
import { LarkService } from './services/lark.service';

@Module({
    imports: [],
    controllers: [CommonController],
    providers: [LarkService],
})
export class CommonModule {}
