import {
    Controller,
    Get,
    Post,
    Param,
    UseGuards,
    Request,
    ParseIntPipe,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) { }

    @Get()
    async findAll(@Request() req) {
        return this.notificationsService.findAllForUser(req.user.userId);
    }

    @Get('unread-count')
    async getUnreadCount(@Request() req) {
        return this.notificationsService.getUnreadCount(req.user.userId);
    }

    @Post(':id/read')
    async markAsRead(
        @Request() req,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.notificationsService.markAsRead(req.user.userId, id);
    }
}
