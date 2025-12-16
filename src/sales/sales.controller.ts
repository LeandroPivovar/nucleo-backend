import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Param,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('sales')
@UseGuards(JwtAuthGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Request() req, @Body() createSaleDto: CreateSaleDto) {
    return this.salesService.create(req.user.userId, createSaleDto);
  }

  @Get()
  async findAll(@Request() req) {
    return this.salesService.findAll(req.user.userId);
  }

  @Get('product/:productId')
  async findByProduct(
    @Request() req,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.salesService.findByProduct(productId, req.user.userId);
  }
}

