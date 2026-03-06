import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    UseGuards,
    Request,
    Body,
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

    @Delete(':id')
    async delete(
        @Request() req,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.notificationsService.markAsDeleted(req.user.userId, id);
    }

    @Get('preferences')
    async getPreferences(@Request() req) {
        return this.notificationsService.getPreferences(req.user.userId);
    }

    @Post('preferences')
    async updatePreferences(@Request() req, @Body() body: { type: any, enabled: boolean }[]) {
        return this.notificationsService.updatePreferences(req.user.userId, body);
    }
}
