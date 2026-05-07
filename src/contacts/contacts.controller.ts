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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImportContactRow } from './dto/import-contacts.dto';
import * as XLSX from 'xlsx';

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req, @Body() createContactDto: CreateContactDto) {
    return this.contactsService.create(req.user.userId, createContactDto);
  }

  @Get()
  findAll(@Request() req) {
    return this.contactsService.findAll(req.user.userId);
  }

  @Get('segmentation-stats')
  getSegmentationStats(@Request() req) {
    return this.contactsService.getSegmentationStats(req.user.userId);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importContacts(
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

    let rows: ImportContactRow[] = [];

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
      const header = parseCSVLine(headerLine).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));

      if (!header.includes('nome')) {
        throw new BadRequestException('A planilha deve conter a coluna "Nome"');
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
          name: getValue('nome') || '',
          phone: getValue('telefone'),
          email: getValue('email'),
          group: getValue('grupo'),
          status: getValue('status'),
          tags: getValue('etiquetas'),
          state: getValue('estado'),
          city: getValue('cidade'),
          birthDate: getValue('data de nascimento'),
          gender: getValue('gênero'),
          segmentations: getValue('segmentações'),
          lastName: getValue('sobrenome'),
          company: getValue('empresa'),
          position: getValue('cargo'),
          notes: getValue('notas'),
          source: getValue('origem'),
        });
      }
    } else {
      // Parse Excel (.xlsx, .xls) usando a biblioteca xlsx
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new BadRequestException('Planilha Excel vazia ou inválida');
      }
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Converte a aba para JSON (array de objetos onde as chaves são o cabeçalho)
      const excelData = XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, any>[];

      if (excelData.length === 0) {
        throw new BadRequestException('Planilha deve conter pelo menos uma linha de dados');
      }

      // Normalizar chaves para lowercase
      const firstRow = excelData[0] || {};
      const lowerKeys = Object.keys(firstRow).map(k => k.trim().toLowerCase());

      if (!lowerKeys.includes('nome')) {
        throw new BadRequestException('A planilha deve conter a coluna "Nome"');
      }

      rows = excelData.map(row => {
        // Objeto intermediário com chaves minúsculas para facilitar a extração
        const lowerRow: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
          lowerRow[key.trim().toLowerCase()] = value !== null && value !== undefined ? String(value).trim() : '';
        }

        return {
          name: lowerRow['nome'] || '',
          phone: lowerRow['telefone'] || undefined,
          email: lowerRow['email'] || undefined,
          group: lowerRow['grupo'] || undefined,
          status: lowerRow['status'] || undefined,
          tags: lowerRow['etiquetas'] || undefined,
          state: lowerRow['estado'] || undefined,
          city: lowerRow['cidade'] || undefined,
          birthDate: lowerRow['data de nascimento'] || undefined,
          gender: lowerRow['gênero'] || undefined,
          segmentations: lowerRow['segmentações'] || undefined,
          lastName: lowerRow['sobrenome'] || undefined,
          company: lowerRow['empresa'] || undefined,
          position: lowerRow['cargo'] || undefined,
          notes: lowerRow['notas'] || undefined,
          source: lowerRow['origem'] || undefined,
        };
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException('Nenhum contato encontrado na planilha');
    }

    const result = await this.contactsService.importFromCSV(req.user.userId, rows);
    return result;
  }

  @Post('segments')
  @HttpCode(HttpStatus.OK)
  async getBySegments(@Request() req, @Body('segmentations') segmentations: any[], @Body('groupIds') groupIds?: number[]) {
    return this.contactsService.getContactsBySegments(req.user.userId, segmentations, groupIds);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.contactsService.findOne(req.user.userId, +id);
  }

  @Patch(':id')
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateContactDto: UpdateContactDto,
  ) {
    return this.contactsService.update(req.user.userId, +id, updateContactDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req, @Param('id') id: string) {
    return this.contactsService.remove(req.user.userId, +id);
  }
}

