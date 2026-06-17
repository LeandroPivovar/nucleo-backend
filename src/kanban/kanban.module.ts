import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KanbanController } from './kanban.controller';
import { KanbanService } from './kanban.service';
import { KanbanColumn } from '../entities/kanban-column.entity';
import { KanbanCard } from '../entities/kanban-card.entity';
import { User } from '../entities/user.entity';
import { Contact } from '../entities/contact.entity';
import { CampaignsModule } from '../campaigns/campaigns.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([KanbanColumn, KanbanCard, User, Contact]),
        CampaignsModule,
    ],
    controllers: [KanbanController],
    providers: [KanbanService],
    exports: [KanbanService],
})
export class KanbanModule { }
