import { Controller, Get, Post, Body, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { TwilioConnectionsService } from './twilio-connections.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('twilio-connections')
@UseGuards(JwtAuthGuard)
export class TwilioConnectionsController {
  constructor(private readonly twilioConnectionsService: TwilioConnectionsService) {}

  @Post()
  create(@Request() req, @Body() dto: { friendlyName?: string; whatsappFrom?: string }) {
    return this.twilioConnectionsService.createRequest(req.user.userId, dto);
  }

  @Get('config')
  async getConfig(@Request() req) {
    const conn = await this.twilioConnectionsService.getVerifiedConnection(req.user.userId);
    return { configured: !!conn };
  }

  @Get('me')
  findMyRequests(@Request() req) {
    return this.twilioConnectionsService.findMyRequests(req.user.userId);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.twilioConnectionsService.remove(+id, req.user.userId);
  }

  // Admin endpoints
  @Get('admin/pending')
  @UseGuards(AdminGuard)
  findAllPending() {
    return this.twilioConnectionsService.findAllPending();
  }

  @Post('admin/:id/approve')
  @UseGuards(AdminGuard)
  approve(@Param('id') id: string, @Body() data: { accountSid: string; authToken: string; whatsappFrom: string }) {
    return this.twilioConnectionsService.approve(+id, data);
  }

  @Post('admin/:id/reject')
  @UseGuards(AdminGuard)
  reject(@Param('id') id: string, @Body() dto: { reason: string }) {
    return this.twilioConnectionsService.reject(+id, dto.reason);
  }
}
