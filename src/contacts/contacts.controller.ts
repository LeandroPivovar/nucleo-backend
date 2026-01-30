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
      throw new BadRequestException('Arquivo CSV é obrigatório');
    }

    if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
      throw new BadRequestException('Arquivo deve ser um CSV');
    }

    // Parse CSV
    const csvContent = file.buffer.toString('utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      throw new BadRequestException('CSV deve conter pelo menos uma linha de cabeçalho e uma linha de dados');
    }

    // Função auxiliar para parsear linha CSV
    const parseCSVLine = (line: string): string[] => {
      const values: string[] = [];
      let currentValue = '';
      let insideQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          if (insideQuotes && line[j + 1] === '"') {
            // Escaped quote
            currentValue += '"';
            j++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === ',' && !insideQuotes) {
          values.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim()); // Último valor
      return values;
    };

    // Parse header
    const headerLine = lines[0].trim();
    const header = parseCSVLine(headerLine).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));

    // Validar cabeçalho (nome é obrigatório)
    if (!header.includes('nome')) {
      throw new BadRequestException('CSV deve conter a coluna "Nome"');
    }

    // Parse rows
    const rows: ImportContactRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = parseCSVLine(line).map(v => v.replace(/^"|"$/g, '')); // Remove aspas externas

      // Garantir que temos valores suficientes
      while (values.length < header.length) {
        values.push('');
      }

      // Mapear valores para objeto
      const getValue = (colName: string): string | undefined => {
        const index = header.indexOf(colName);
        return index >= 0 && index < values.length ? (values[index] || undefined) : undefined;
      };

      const row: ImportContactRow = {
        name: getValue('nome') || '',
        phone: getValue('telefone'),
        email: getValue('email'),
        group: getValue('grupo'),
        status: getValue('status'),
        tags: getValue('etiquetas'),
        state: getValue('estado'),
        city: getValue('cidade'),
        segmentations: getValue('segmentações'),
      };

      rows.push(row);
    }

    if (rows.length === 0) {
      throw new BadRequestException('Nenhum contato encontrado no CSV');
    }

    const result = await this.contactsService.importFromCSV(req.user.userId, rows);
    return result;
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

