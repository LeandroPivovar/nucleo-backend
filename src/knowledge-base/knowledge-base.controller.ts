import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    ParseIntPipe,
    Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import { CreateTutorialDto } from './dto/create-tutorial.dto';
import { UpdateTutorialDto } from './dto/update-tutorial.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

const uploadDir = join(__dirname, '..', '..', 'uploads', 'knowledge-base');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

@Controller('admin/knowledge-base')
export class KnowledgeBaseController {
    private readonly logger = new Logger(KnowledgeBaseController.name);

    constructor(private readonly knowledgeBaseService: KnowledgeBaseService) { }

    @Get()
    @UseGuards(JwtAuthGuard)
    findAll() {
        return this.knowledgeBaseService.findAll();
    }

    @Post()
    @UseGuards(JwtAuthGuard, AdminGuard)
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: uploadDir,
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                cb(null, `tutorial-${uniqueSuffix}${extname(file.originalname)}`);
            },
        }),
        fileFilter: (req, file, cb) => {
            if (file.mimetype !== 'application/pdf') {
                return cb(new BadRequestException('Apenas arquivos PDF são permitidos'), false);
            }
            cb(null, true);
        },
        limits: {
            fileSize: 20 * 1024 * 1024, // 20MB
        },
    }))
    async create(
        @Body() createTutorialDto: CreateTutorialDto,
        @UploadedFile() file: Express.Multer.File
    ) {
        this.logger.debug(`Recebendo criação de tutorial: ${JSON.stringify(createTutorialDto)}`);
        if (!file) throw new BadRequestException('Arquivo PDF é obrigatório');

        const pdfUrl = `/api/admin/knowledge-base/serve/${file.filename}`;
        return this.knowledgeBaseService.create({ 
            title: createTutorialDto.title, 
            pdfUrl 
        });
    }

    @Patch(':id')
    @UseGuards(JwtAuthGuard, AdminGuard)
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: uploadDir,
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                cb(null, `tutorial-${uniqueSuffix}${extname(file.originalname)}`);
            },
        }),
        fileFilter: (req, file, cb) => {
            if (file.mimetype !== 'application/pdf') {
                return cb(new BadRequestException('Apenas arquivos PDF são permitidos'), false);
            }
            cb(null, true);
        },
        limits: {
            fileSize: 20 * 1024 * 1024, // 20MB
        },
    }))
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateTutorialDto: UpdateTutorialDto,
        @UploadedFile() file?: Express.Multer.File
    ) {
        const updateData: any = {};
        if (updateTutorialDto.title) updateData.title = updateTutorialDto.title;
        if (file) {
            updateData.pdfUrl = `/api/admin/knowledge-base/serve/${file.filename}`;
        }
        return this.knowledgeBaseService.update(id, updateData);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, AdminGuard)
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.knowledgeBaseService.remove(id);
    }

    @Get('serve/:filename')
    serveFile(@Param('filename') filename: string, @Res() res: any) {
        const filePath = join(uploadDir, filename);
        if (!fs.existsSync(filePath)) {
            throw new BadRequestException('Arquivo não encontrado');
        }
        return res.sendFile(filename, { root: uploadDir });
    }
}
