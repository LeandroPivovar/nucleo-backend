import { Controller, Get, Post, Body, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { TwilioConnectionsService } from './twilio-connections.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('twilio-connections')
@UseGuards(JwtAuthGuard)
export class TwilioConnectionsController {
  constructor(private readonly twilioConnectionsService: TwilioConnectionsService) {}

  @Post()
  create(@Request() req, @Body() dto: { friendlyName?: string; whatsappFrom: string }) {
    return this.twilioConnectionsService.createRequest(req.user.id, dto);
  }

  @Get('me')
  findMyRequests(@Request() req) {
    return this.twilioConnectionsService.findMyRequests(req.user.id);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.twilioConnectionsService.remove(+id, req.user.id);
  }

  // Admin endpoints
  @Get('admin/pending')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAllPending() {
    return this.twilioConnectionsService.findAllPending();
  }

  @Post('admin/:id/approve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  approve(@Param('id') id: string, @Body() credentials: { accountSid: string; authToken: string }) {
    return this.twilioConnectionsService.approve(+id, credentials);
  }

  @Post('admin/:id/reject')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  reject(@Param('id') id: string, @Body() dto: { reason: string }) {
    return this.twilioConnectionsService.reject(+id, dto.reason);
  }
}
