import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { ShopifyService } from '../shopify/shopify.service';

@Injectable()
export class ShopifySessionStrategy extends PassportStrategy(Strategy, 'shopify-session') {
  constructor(
    private configService: ConfigService,
    private shopifyService: ShopifyService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('SHOPIFY_CLIENT_SECRET') || 'dummy-secret-shopify-client-secret',
      algorithms: ['HS256'],
    });
  }

  async validate(payload: any) {
    // A carga útil do Session Token da Shopify contém o domínio da loja em 'dest'
    // Exemplo de payload.dest: "https://minha-loja.myshopify.com"
    if (!payload.dest) {
      throw new UnauthorizedException('Token de sessão Shopify inválido: campo dest ausente');
    }

    const shop = payload.dest.replace('https://', '');
    
    // Buscar a conexão ativa para esta loja para identificar o usuário CRM associado
    const connection = await this.shopifyService.findActiveConnectionByShop(shop);
    if (!connection) {
      // Se não houver conexão ativa, não podemos autenticar o usuário
      throw new UnauthorizedException(`Loja Shopify (${shop}) não está conectada a este sistema.`);
    }

    // Retorna os dados do usuário para serem anexados ao objeto req.user
    // Incluímos 'isShopify' para distinguir este tipo de autenticação se necessário
    return { 
      userId: connection.userId, 
      shop: connection.shop, 
      isShopify: true 
    };
  }
}
