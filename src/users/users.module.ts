import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AdminController } from './admin.controller';
import { User } from '../entities/user.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Plan, Subscription])],
  controllers: [UsersController, AdminController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }

