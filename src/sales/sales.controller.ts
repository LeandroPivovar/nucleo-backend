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
  Query,
  DefaultValuePipe,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('sales')
@UseGuards(JwtAuthGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) { }

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
  @Get('dashboard/stats')
  async getDashboardStats(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
  ) {
    return this.salesService.getDashboardStats(req.user.userId, period);
  }

  @Get('dashboard/campaigns')
  async getSalesByCampaign(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
  ) {
    return this.salesService.getSalesByCampaign(req.user.userId, period);
  }

  @Get('dashboard/channels')
  async getSalesByChannel(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
  ) {
    return this.salesService.getSalesByChannel(req.user.userId, period);
  }

  @Get('dashboard/products')
  async getTopProducts(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
  ) {
    return this.salesService.getTopProducts(req.user.userId, period);
  }

  @Get('dashboard/payment-methods')
  async getPaymentMethods(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
  ) {
    return this.salesService.getPaymentMethods(req.user.userId, period);
  }

  @Get('dashboard/funnel')
  async getFunnelStats(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
  ) {
    return this.salesService.getFunnelStats(req.user.userId, period);
  }

  @Get('dashboard/segmentation')
  async getSegmentationStats(
    @Request() req
  ) {
    return this.salesService.getSegmentationStats(req.user.userId);
  }
}

