import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShopifyService } from '../shopify/shopify.service';
import { NuvemshopService } from '../nuvemshop/nuvemshop.service';
import { VtexService } from '../vtex/vtex.service';
import { LojaIntegradaService } from '../loja-integrada/loja-integrada.service';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import { VtexConnection } from '../entities/vtex-connection.entity';
import { LojaIntegradaConnection } from '../entities/loja-integrada-connection.entity';
import { TrayService } from '../tray/tray.service';
import { TrayConnection } from '../entities/tray-connection.entity';

@Injectable()
export class SyncSchedulerService {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(
    private shopifyService: ShopifyService,
    private nuvemshopService: NuvemshopService,
    private vtexService: VtexService,
    private lojaIntegradaService: LojaIntegradaService,
    @InjectRepository(ShopifyConnection)
    private shopifyRepo: Repository<ShopifyConnection>,
    @InjectRepository(NuvemshopConnection)
    private nuvemshopRepo: Repository<NuvemshopConnection>,
    @InjectRepository(VtexConnection)
    private vtexRepo: Repository<VtexConnection>,
    @InjectRepository(LojaIntegradaConnection)
    private liRepo: Repository<LojaIntegradaConnection>,
    private trayService: TrayService,
    @InjectRepository(TrayConnection)
    private trayRepo: Repository<TrayConnection>,
  ) {}

  /**
   * Cron job que roda a cada hora para sincronizar todas as integrações ativas
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log('Iniciando sincronização global em background...');
    
    await Promise.allSettled([
      this.syncAllShopify(),
      this.syncAllNuvemshop(),
      this.syncAllVtex(),
      this.syncAllLojaIntegrada(),
      this.syncAllTray(),
    ]);

    this.logger.log('Sincronização global concluída.');
  }

  private async syncAllShopify() {
    const connections = await this.shopifyRepo.find({ where: { isActive: true } });
    this.logger.log(`Sincronizando ${connections.length} lojas Shopify...`);
    
    for (const conn of connections) {
      try {
        await this.shopifyService.syncAll(conn.userId, conn.shop);
      } catch (err) {
        this.logger.error(`Erro ao sincronizar Shopify (${conn.shop}): ${err.message}`);
      }
    }
  }

  private async syncAllNuvemshop() {
    const connections = await this.nuvemshopRepo.find({ where: { isActive: true } });
    this.logger.log(`Sincronizando ${connections.length} lojas Nuvemshop...`);
    
    for (const conn of connections) {
      try {
        await this.nuvemshopService.syncAll(conn.userId, conn.storeId);
      } catch (err) {
        this.logger.error(`Erro ao sincronizar Nuvemshop (${conn.storeId}): ${err.message}`);
      }
    }
  }

  private async syncAllVtex() {
    const connections = await this.vtexRepo.find({ where: { isActive: true } });
    this.logger.log(`Sincronizando ${connections.length} lojas VTEX...`);
    
    for (const conn of connections) {
      try {
        await this.vtexService.syncAll(conn.userId, conn.accountName);
      } catch (err) {
        this.logger.error(`Erro ao sincronizar VTEX (${conn.accountName}): ${err.message}`);
      }
    }
  }

  private async syncAllLojaIntegrada() {
    const connections = await this.liRepo.find({ where: { isActive: true } });
    this.logger.log(`Sincronizando ${connections.length} lojas Loja Integrada...`);
    
    for (const conn of connections) {
      try {
        await this.lojaIntegradaService.syncAll(conn.userId);
      } catch (err) {
        this.logger.error(`Erro ao sincronizar Loja Integrada (User: ${conn.userId}): ${err.message}`);
      }
    }
  }

  private async syncAllTray() {
    const connections = await this.trayRepo.find({ where: { isActive: true } });
    this.logger.log(`Sincronizando ${connections.length} lojas Tray...`);
    
    for (const conn of connections) {
      try {
        await this.trayService.syncProducts(conn.userId);
        await this.trayService.syncOrders(conn.userId);
        await this.trayService.syncCustomers(conn.userId);
      } catch (err) {
        this.logger.error(`Erro ao sincronizar Tray (User: ${conn.userId}): ${err.message}`);
      }
    }
  }
}
