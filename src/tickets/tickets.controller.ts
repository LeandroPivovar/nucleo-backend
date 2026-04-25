import { Controller, Get, Post, Body, Param, UseGuards, Request, Put, ForbiddenException } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(@Request() req, @Body() data: { subject: string; category: string; message: string }) {
    return this.ticketsService.createTicket(req.user, data);
  }

  @Get()
  findAll(@Request() req) {
    if (req.user.role === 'admin') {
      return this.ticketsService.getAllTicketsForAdmin();
    }
    return this.ticketsService.getUserTickets(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.ticketsService.getTicketById(+id, req.user.id, req.user.role === 'admin');
  }

  @Post(':id/messages')
  addMessage(@Request() req, @Param('id') id: string, @Body() data: { message: string }) {
    return this.ticketsService.addMessage(+id, req.user, data.message, req.user.role === 'admin');
  }

  @Put(':id/finish')
  finish(@Request() req, @Param('id') id: string) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Apenas administradores podem finalizar tickets');
    }
    return this.ticketsService.finishTicket(+id);
  }
}
