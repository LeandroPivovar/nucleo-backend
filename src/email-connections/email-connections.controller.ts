import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { EmailConnectionsService } from './email-connections.service';
import { CreateEmailConnectionDto } from './dto/create-email-connection.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('email-connections')
@UseGuards(JwtAuthGuard)
export class EmailConnectionsController {
  constructor(private readonly emailConnectionsService: EmailConnectionsService) {}

  @Get()
  async findAll(@Request() req) {
    return this.emailConnectionsService.findAll(req.user.userId);
  }

  @Get(':id')
  async findOne(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.emailConnectionsService.findOne(id, req.user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Request() req, @Body() dto: CreateEmailConnectionDto) {
    return this.emailConnectionsService.create(req.user.userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Request() req, @Param('id', ParseIntPipe) id: number) {
    await this.emailConnectionsService.remove(id, req.user.userId);
  }
}


