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
// Absolute path to the upload directory
const uploadDir = join(process.cwd(), 'uploads', 'campaigns');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

@Controller('campaign-assets')
export class UploadsController {
    private readonly logger = new Logger(UploadsController.name);

    @Post('upload')
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
        this.logger.log(`File uploaded: ${file.filename} to ${file.path}`);

        return {
            url: `/api/campaign-assets/${file.filename}`,
            name: file.originalname,
            type: file.mimetype.startsWith('video/') ? 'video' : 'image'
        };
    }

    @Get(':filename')
    serveFile(@Param('filename') filename: string, @Res() res: Response) {
        const filePath = join(uploadDir, filename);
        
        if (!fs.existsSync(filePath)) {
            this.logger.error(`Arquivo não encontrado: ${filePath}`);
            return res.status(404).send('Arquivo não encontrado');
        }

        const stats = fs.statSync(filePath);
        const ext = extname(filename).toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.gif') contentType = 'image/gif';
        else if (ext === '.mp4') contentType = 'video/mp4';
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        
        this.logger.log(`Serving file: ${filename} (${stats.size} bytes) - Type: ${contentType}`);
        
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    }
}
