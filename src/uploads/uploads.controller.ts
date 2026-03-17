import {
    Controller,
    Post,
    Get,
    Param,
    Res,
    UploadedFile,
    UseInterceptors,
    BadRequestException,
    UseGuards,
    Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import * as fs from 'fs';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Absolute path to the upload directory
const uploadDir = join(__dirname, '..', '..', 'uploads', 'campaigns');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

@Controller('uploads')
export class UploadsController {
    private readonly logger = new Logger(UploadsController.name);

    @Post('campaign-media')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: uploadDir,
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
            },
        }),
        limits: {
            fileSize: 10 * 1024 * 1024, // 10MB
        },
    }))
    uploadFile(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('Nenhum arquivo enviado');
        }
        this.logger.log(`File uploaded: ${file.filename}`);

        // Using a simple path that will be prefixed by BACKEND_URL in the EmailService
        // or returned to the frontend as a relative path.
        return {
            url: `/api/uploads/campaign-media/${file.filename}`,
            name: file.originalname,
            type: file.mimetype.startsWith('video/') ? 'video' : 'image'
        };
    }

    @Get('campaign-media/:filename')
    serveFile(@Param('filename') filename: string, @Res() res: Response) {
        const filePath = join(uploadDir, filename);
        if (!fs.existsSync(filePath)) {
            throw new BadRequestException('Arquivo não encontrado');
        }
        return res.sendFile(filename, { root: uploadDir });
    }
}
