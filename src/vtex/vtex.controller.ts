import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { VtexService } from './vtex.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateVtexConnectionDto } from './dto/create-vtex-connection.dto';

@Controller('vtex')
export class VtexController {
  constructor(private readonly vtexService: VtexService) {}

  /**
   * Conecta uma loja VTEX
   * Valida as credenciais e salva a conexão
   */
  @Post('auth/connect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async connect(
    @Request() req,
    @Body() createVtexConnectionDto: CreateVtexConnectionDto,
  ) {
    const { accountName, appKey, appToken } = createVtexConnectionDto;

    // Normalizar accountName (remover .myvtex.com se presente)
    const normalizedAccountName = accountName
      .replace(/\.myvtex\.com$/, '')
      .replace(/^https?:\/\//, '')
      .replace(/\.myvtex\.com\/?$/, '')
      .trim();

    if (!normalizedAccountName) {
      throw new BadRequestException('Account Name é obrigatório');
    }

    // Validar e salvar conexão
    const connection = await this.vtexService.createOrUpdateConnection(
      req.user.userId,
      normalizedAccountName,
      appKey,
      appToken,
    );

    return {
      success: true,
      connection: {
        id: connection.id,
        accountName: connection.accountName,
        isActive: connection.isActive,
      },
    };
  }

  /**
   * Lista conexões do usuário
   */
  @Get('connections')
  @UseGuards(JwtAuthGuard)
  async getConnections(@Request() req) {
    const connections = await this.vtexService.getConnections(req.user.userId);
    return connections.map(conn => ({
      id: conn.id,
      accountName: conn.accountName,
      isActive: conn.isActive,
      lastSyncAt: conn.lastSyncAt,
      createdAt: conn.createdAt,
    }));
  }

  /**
   * Testa a conexão e valida as credenciais
   */
  @Post('test-connection')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async testConnection(
    @Request() req,
    @Body() body: { accountName: string },
  ) {
    const isValid = await this.vtexService.testConnection(
      req.user.userId,
      body.accountName,
    );

    return {
      success: isValid,
      message: isValid
        ? 'Conexão válida'
        : 'Credenciais inválidas. Verifique suas credenciais e reconecte a integração.',
    };
  }

  /**
   * Desconecta uma loja
   */
  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disconnect(
    @Request() req,
    @Body() body: { accountName: string },
  ) {
    await this.vtexService.deactivateConnection(
      req.user.userId,
      body.accountName,
    );

    return {
      success: true,
      message: 'Conexão desativada com sucesso',
    };
  }
}

