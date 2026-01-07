import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Logger,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name);

  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Request() req, @Body() createProductDto: CreateProductDto) {
    return this.productsService.create(req.user.userId, createProductDto);
  }

  /**
   * Importa produto de integração (cria ou atualiza se já existir)
   * Verifica por SKU ou externalIds antes de criar
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  async importProduct(
    @Request() req,
    @Body()
    importData: CreateProductDto & {
      externalIds?: {
        nuvemshop?: Record<string, number>;
        shopify?: Record<string, string>;
      };
    },
  ) {
    this.logger.log(`[IMPORT] Recebida requisição de importação:`, {
      userId: req.user.userId,
      name: importData.name,
      sku: importData.sku || 'não informado',
      externalIds: importData.externalIds,
    });
    
    const result = await this.productsService.createOrUpdateFromIntegration(req.user.userId, importData);
    
    this.logger.log(`[IMPORT] Produto processado:`, {
      id: result.id,
      name: result.name,
      sku: result.sku,
      externalIds: result.externalIds,
    });
    
    return result;
  }

  @Get()
  async findAll(@Request() req) {
    return this.productsService.findAll(req.user.userId);
  }

  @Get(':id')
  async findOne(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.update(id, req.user.userId, updateProductDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Request() req, @Param('id', ParseIntPipe) id: number) {
    await this.productsService.remove(id, req.user.userId);
  }
}

