import { Module } from '@nestjs/common';
import { ZenviaService } from './zenvia.service';

@Module({
    providers: [ZenviaService],
    exports: [ZenviaService]
})
export class ZenviaModule { }
