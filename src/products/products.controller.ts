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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImportProductRow } from './dto/import-products.dto';
import * as XLSX from 'xlsx';

// Ensure the upload directory exists using absolute path from __dirname
const uploadDir = join(__dirname, '..', '..', 'uploads', 'products');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name);

  constructor(private readonly productsService: ProductsService) { }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
      },
    }),
  }))
  uploadProductPhoto(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }
    // Mangle the extension with '---' to bypass aggressive Nginx static file traps
    const safeFilename = file.filename.replace('.', '---');
    return { url: `/api/products-image/${safeFilename}` };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Request() req, @Body() createProductDto: CreateProductDto) {
    return this.productsService.create(req.user.userId, createProductDto);
  }

  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet) as ImportProductRow[];

      if (rows.length === 0) {
        throw new BadRequestException('A planilha está vazia');
      }

      if (rows.length > 5000) {
        throw new BadRequestException('A planilha excede o limite de 5000 linhas');
      }

      const result = await this.productsService.importFromCSV(req.user.userId, rows);
      return result;
    } catch (error) {
      this.logger.error(`Erro ao importar produtos Excel: ${error.message}`, error.stack);
      throw new BadRequestException(error.message || 'Erro ao processar planilha');
    }
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
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.productsService.remove(id, req.user.id);
  }

  @Get('import/template')
  @HttpCode(HttpStatus.OK)
  async downloadTemplate(@Res() res: Response) {
    const data = [
      {
        'Nome': 'Produto Exemplo 1',
        'Descrição': 'Descrição detalhada do produto 1',
        'SKU': 'SKU001',
        'Categoria': 'Eletrônicos',
        'Preço': 99.90,
        'Estoque': 50,
        'Status': 'Ativo'
      },
      {
        'Nome': 'Produto Exemplo 2',
        'Descrição': 'Descrição detalhada do produto 2',
        'SKU': 'SKU002',
        'Categoria': 'Vestuário',
        'Preço': 49.99,
        'Estoque': 100,
        'Status': 'Ativo'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Produtos');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=modelo_importacao_produtos.xlsx');
    
    return res.send(buffer);
  }
}

@Controller('products-image')
export class ProductsImageController {
  @Get(':id')
  serveImage(@Param('id') id: string, @Res() res: Response) {
    const filename = id.replace('---', '.');
    return res.sendFile(filename, { root: join(__dirname, '..', '..', 'uploads', 'products') });
  }
}
