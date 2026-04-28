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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SalesLoggingInterceptor } from './sales-logging.interceptor';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImportSaleRow } from './dto/import-sales.dto';
import * as XLSX from 'xlsx';

@Controller('sales')
@UseGuards(JwtAuthGuard)
@UseInterceptors(SalesLoggingInterceptor)
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
    @Query('campaignId', new ParseIntPipe({ optional: true })) campaignId?: number,
    @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
  ) {
    return this.salesService.getDashboardStats(req.user.userId, period, { campaignId, productId });
  }

  @Get('dashboard/campaigns')
  async getSalesByCampaign(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
    @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
  ) {
    return this.salesService.getSalesByCampaign(req.user.userId, period, { productId });
  }

  @Get('dashboard/channels')
  async getSalesByChannel(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
    @Query('campaignId', new ParseIntPipe({ optional: true })) campaignId?: number,
    @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
  ) {
    return this.salesService.getSalesByChannel(req.user.userId, period, { campaignId, productId });
  }

  @Get('dashboard/products')
  async getTopProducts(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
    @Query('campaignId', new ParseIntPipe({ optional: true })) campaignId?: number,
  ) {
    return this.salesService.getTopProducts(req.user.userId, period, { campaignId });
  }

  @Get('dashboard/payment-methods')
  async getPaymentMethods(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
    @Query('campaignId', new ParseIntPipe({ optional: true })) campaignId?: number,
    @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
  ) {
    return this.salesService.getPaymentMethods(req.user.userId, period, { campaignId, productId });
  }

  @Get('dashboard/funnel')
  async getFunnelStats(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
    @Query('campaignId', new ParseIntPipe({ optional: true })) campaignId?: number,
    @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
  ) {
    return this.salesService.getFunnelStats(req.user.userId, period, { campaignId, productId });
  }

  @Get('dashboard/segmentation')
  async getSegmentationStats(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
    @Query('campaignId', new ParseIntPipe({ optional: true })) campaignId?: number,
    @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
  ) {
    return this.salesService.getSegmentationStats(req.user.userId, period, { campaignId, productId });
  }

  @Get('dashboard/heatmap')
  async getDashboardHeatmap(
    @Request() req,
    @Query('period', new DefaultValuePipe(30), ParseIntPipe) period: number,
    @Query('campaignId', new ParseIntPipe({ optional: true })) campaignId?: number,
    @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
  ) {
    return this.salesService.getDashboardHeatmap(req.user.userId, period, { campaignId, productId });
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importSales(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Planilha é obrigatória');
    }

    const isCsv = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv');
    const isExcel = file.mimetype.includes('excel') ||
      file.mimetype.includes('spreadsheetml') ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls');

    if (!isCsv && !isExcel) {
      throw new BadRequestException('Arquivo deve ser uma planilha Excel (.xlsx, .xls) ou CSV (.csv)');
    }

    let rows: ImportSaleRow[] = [];

    if (isCsv) {
      // Parse CSV Manual
      const csvContent = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
      const lines = csvContent.split('\n').filter(line => line.trim());

      if (lines.length < 2) {
        throw new BadRequestException('CSV deve conter pelo menos uma linha de cabeçalho e uma linha de dados');
      }

      const delimiter = lines[0].indexOf(';') !== -1 ? ';' : ',';

      const parseCSVLine = (line: string): string[] => {
        const values: string[] = [];
        let currentValue = '';
        let insideQuotes = false;

        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          if (char === '"') {
            if (insideQuotes && j + 1 < line.length && line[j + 1] === '"') {
              currentValue += '"';
              j++;
            } else {
              insideQuotes = !insideQuotes;
            }
          } else if (char === delimiter && !insideQuotes) {
            values.push(currentValue.trim());
            currentValue = '';
          } else {
            currentValue += char;
          }
        }
        values.push(currentValue.trim());
        return values;
      };

      const headerLine = lines[0].trim();
      const header = parseCSVLine(headerLine).map(h => h.trim().toLowerCase().replace(/^"|"$ /g, ''));

      if (!header.includes('email')) {
        throw new BadRequestException('A planilha deve conter a coluna "Email" do comprador');
      }

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = parseCSVLine(line).map(v => v.replace(/^"|"$/g, ''));

        while (values.length < header.length) {
          values.push('');
        }

        const getValue = (colName: string): string | undefined => {
          const index = header.indexOf(colName);
          return index >= 0 && index < values.length ? (values[index] || undefined) : undefined;
        };

        rows.push({
          email: getValue('email') || '',
          customerName: getValue('nome') || getValue('cliente'),
          productName: getValue('produto') || getValue('item'),
          sku: getValue('sku'),
          quantity: getValue('quantidade') || '1',
          unitPrice: getValue('valor unitario') || getValue('preço unitario'),
          totalValue: getValue('valor total') || getValue('total') || '0',
          paymentMethod: getValue('metodo pagamento') || getValue('pagamento'),
          status: getValue('status'),
          channel: getValue('canal'),
          date: getValue('data'),
        });
      }
    } else {
      // Parse Excel (.xlsx, .xls)
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new BadRequestException('Planilha Excel vazia ou inválida');
      }
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      const excelData = XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, any>[];

      if (excelData.length === 0) {
        throw new BadRequestException('Planilha deve conter pelo menos uma linha de dados');
      }

      const firstRow = excelData[0] || {};
      const lowerKeys = Object.keys(firstRow).map(k => k.trim().toLowerCase());

      if (!lowerKeys.includes('email')) {
        throw new BadRequestException('A planilha deve conter a coluna "Email" do comprador');
      }

      rows = excelData.map(row => {
        const lowerRow: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
          lowerRow[key.trim().toLowerCase()] = value !== null && value !== undefined ? String(value).trim() : '';
        }

        return {
          email: lowerRow['email'] || '',
          customerName: lowerRow['nome'] || lowerRow['cliente'],
          productName: lowerRow['produto'] || lowerRow['item'],
          sku: lowerRow['sku'],
          quantity: lowerRow['quantidade'] || '1',
          unitPrice: lowerRow['valor unitario'] || lowerRow['preço unitario'],
          totalValue: lowerRow['valor total'] || lowerRow['total'] || '0',
          paymentMethod: lowerRow['metodo pagamento'] || lowerRow['pagamento'],
          status: lowerRow['status'],
          channel: lowerRow['canal'],
          date: lowerRow['data'],
        };
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException('Nenhuma venda encontrada na planilha');
    }

    return this.salesService.importFromCSV(req.user.userId, rows);
  }
}


