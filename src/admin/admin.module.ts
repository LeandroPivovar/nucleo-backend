import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User } from '../entities/user.entity';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            User,
            Subscription,
            Plan,
            Invoice,
        ]),
    ],
    controllers: [AdminController],
    providers: [AdminService],
    exports: [AdminService],
})
export class AdminModule { }
