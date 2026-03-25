import {
    Controller,
    Post,
    Body,
    UseGuards,
    Request,
    Get,
} from '@nestjs/common';
import { LojaIntegradaService } from './loja-integrada.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('loja-integrada')
@UseGuards(JwtAuthGuard)
export class LojaIntegradaController {
    constructor(private readonly liService: LojaIntegradaService) { }

    @Post('connect')
    async connect(
        @Request() req,
        @Body() body: { storeName: string; apiKey: string; applicationKey: string },
    ) {
        return this.liService.createOrUpdateConnection(
            req.user.userId,
            body.storeName,
            body.apiKey,
            body.applicationKey,
        );
    }

    @Get('connection')
    async getConnection(@Request() req) {
        return this.liService.getActiveConnection(req.user.userId);
    }

    @Post('sync')
    async sync(@Request() req) {
        const products = await this.liService.syncProducts(req.user.userId);
        const orders = await this.liService.syncOrders(req.user.userId);
        const checkouts = await this.liService.syncCheckouts(req.user.userId);
        return { products, orders, checkouts };
    }
}
