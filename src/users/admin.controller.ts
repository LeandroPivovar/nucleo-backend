import {
    Controller,
    Get,
    Patch,
    Post,
    Body,
    Param,
    ParseIntPipe
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';

@Controller('admin/users')
export class AdminController {
    constructor(private readonly usersService: UsersService) { }

    @Get()
    async findAll() {
        return this.usersService.findAllAdmin();
    }

    @Patch(':id')
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateData: Partial<User>
    ) {
        return this.usersService.updateAdmin(id, updateData);
    }

    @Post(':id/plan')
    async assignPlan(
        @Param('id', ParseIntPipe) id: number,
        @Body('planId') planId: number | null
    ) {
        return this.usersService.assignPlan(id, planId);
    }
}
