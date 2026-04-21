import {
    Controller,
    Get,
    Patch,
    Post,
    Body,
    Param,
    ParseIntPipe,
    Query,
    UseGuards
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
    constructor(private readonly usersService: UsersService) { }

    @Get()
    async findAll(@Query('planId') planId?: string) {
        return this.usersService.findAllAdmin(planId ? parseInt(planId) : undefined);
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

    @Patch(':id/subscription-expiry')
    async setSubscriptionExpiry(
        @Param('id', ParseIntPipe) id: number,
        @Body('expiryDate') expiryDate: string
    ) {
        return this.usersService.setSubscriptionExpiry(id, expiryDate);
    }
}
