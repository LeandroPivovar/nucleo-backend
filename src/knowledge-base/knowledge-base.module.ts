import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { Tutorial } from '../entities/tutorial.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Tutorial])],
    controllers: [KnowledgeBaseController],
    providers: [KnowledgeBaseService],
    exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule { }
