import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Body,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Notification } from '../entities/notification.entity';

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard)
export class AdminNotificationsController {
    constructor(private readonly notificationsService: NotificationsService) { }

    @Get()
    async findAll() {
        return this.notificationsService.findAllAdmin();
    }

    @Post()
    async create(@Body() data: Partial<Notification>) {
        return this.notificationsService.create(data);
    }

    @Delete(':id')
    async delete(@Param('id', ParseIntPipe) id: number) {
        return this.notificationsService.delete(id);
    }
}
