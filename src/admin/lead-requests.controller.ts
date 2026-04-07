import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { LeadRequestsService } from './lead-requests.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LeadStatus } from '../entities/lead-request.entity';

@Controller('lead-requests')
export class LeadRequestsController {
  constructor(private readonly leadRequestsService: LeadRequestsService) {}

  /**
   * Endpoint público para captura de leads da Landing Page
   */
  @Post()
  async createPublicLead(@Body() data: any) {
    return this.leadRequestsService.create(data);
  }

  /**
   * Endpoints administrativos protegidos
   */
  @Get('admin/all')
  @UseGuards(JwtAuthGuard)
  async getAllLeads() {
    return this.leadRequestsService.findAll();
  }

  @Patch('admin/:id/status')
  @UseGuards(JwtAuthGuard)
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: LeadStatus,
  ) {
    return this.leadRequestsService.updateStatus(id, status);
  }
}
