import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { TwilioService } from '../twilio/twilio.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Plan)
    private planRepository: Repository<Plan>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    private twilioService: TwilioService,
  ) { }

  async findOne(id: number): Promise<any> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    // Buscar plano atual
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId: id, status: 'active' },
      relations: ['plan'],
    });

    // Retornar objeto com plano
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      planName: subscription?.plan?.name || 'Plano gratuito'
    };
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    // Verificar se o email já está em uso por outro usuário
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.userRepository.findOne({
        where: { email: updateUserDto.email },
      });

      if (existingUser) {
        throw new ConflictException('E-mail já está em uso');
      }
    }

    // Atualizar campos
    Object.assign(user, updateUserDto);

    const updatedUser = await this.userRepository.save(user);

    // Retornar perfil completo com plano
    return this.findOne(updatedUser.id);
  }

  async changePassword(id: number, changePasswordDto: ChangePasswordDto): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    // Verificar senha atual
    const isCurrentPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    // Hash da nova senha
    const hashedNewPassword = await bcrypt.hash(changePasswordDto.newPassword, 10);

    // Atualizar senha
    user.password = hashedNewPassword;
    await this.userRepository.save(user);
  }

  // --- ADMIN METHODS ---

  async findAllAdmin(planId?: number): Promise<any[]> {
    const where: any = {};
    if (planId) {
      where.planId = planId;
    }

    const users = await this.userRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });

    // We can also fetch active subscriptions for all users to show their current plan
    const subscriptions = await this.subscriptionRepository.find({
      where: { status: 'active' },
      relations: ['plan'],
    });

    const subMap = new Map();
    subscriptions.forEach(sub => subMap.set(sub.userId, sub.plan));

    return users.map(u => {
      const { password, ...safeUser } = u;
      return {
        ...safeUser,
        currentPlan: subMap.get(u.id) || null
      };
    });
  }

  async updateAdmin(id: number, adminData: Partial<User>): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (adminData.email && adminData.email !== user.email) {
      const existing = await this.userRepository.findOne({ where: { email: adminData.email } });
      if (existing) throw new ConflictException('E-mail já está em uso.');
    }

    if (adminData.password) {
      adminData.password = await bcrypt.hash(adminData.password, 10);
    }

    Object.assign(user, adminData);
    const updated = await this.userRepository.save(user);
    const { password: _, ...safeUser } = updated;
    return safeUser as User;
  }

  async assignPlan(userId: number, planId: number | null): Promise<Subscription | { success: boolean; message: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Inactivate old subscriptions regardless of fetching a new plan
    await this.subscriptionRepository.update(
      { userId, status: 'active' },
      { status: 'canceled' }
    );

    if (!planId) {
      return { success: true, message: 'Plano removido com sucesso, conta rebaixada para o modo gratuito.' };
    }

    const plan = await this.planRepository.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plano não encontrado');

    // Creates new subscription
    const newSubscription = this.subscriptionRepository.create({
      userId,
      planId,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(new Date().setMonth(new Date().getMonth() + 1)), // 1 month
    });

    return this.subscriptionRepository.save(newSubscription);
  }

  async setSubscriptionExpiry(userId: number, expiryDate: string) {
    const subscription = await this.subscriptionRepository.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });

    if (!subscription) throw new NotFoundException('Nenhuma assinatura ativa encontrada para este usuário');

    subscription.currentPeriodEnd = new Date(expiryDate);
    return this.subscriptionRepository.save(subscription);
  }

  async wipeData(userId: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    await this.userRepository.manager.transaction(async (transactionalEntityManager) => {
      // 1. Deletar cliques e fila de campanhas (que não têm userId direto, mas têm campaignId)
      // Nota: Algumas entidades têm onDelete: 'CASCADE' no entity config, mas vamos garantir aqui.

      await transactionalEntityManager.query(
        `DELETE FROM \`campaign_clicks\` WHERE \`campaignId\` IN (SELECT \`id\` FROM \`campaigns\` WHERE \`userId\` = ?)`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`campaign_queue\` WHERE \`user_id\` = ?`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`campaign_coupons\` WHERE \`userId\` = ?`,
        [userId]
      );

      // 2. Deletar dados de compras e tags dos contatos
      await transactionalEntityManager.query(
        `DELETE FROM \`contact_purchases\` WHERE \`contactId\` IN (SELECT \`id\` FROM \`contacts\` WHERE \`userId\` = ?)`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`contact_tags\` WHERE \`contactId\` IN (SELECT \`id\` FROM \`contacts\` WHERE \`userId\` = ?)`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`contact_segmentations\` WHERE \`contactId\` IN (SELECT \`id\` FROM \`contacts\` WHERE \`userId\` = ?)`,
        [userId]
      );

      // 3. Deletar eventos de pixel
      await transactionalEntityManager.query(
        `DELETE FROM \`pixel_events\` WHERE \`pixelId\` IN (SELECT \`pixelId\` FROM \`pixels\` WHERE \`userId\` = ?)`,
        [userId]
      );

      // 4. Deletar vendas (têm userId)
      await transactionalEntityManager.query(
        `DELETE FROM \`sales\` WHERE \`userId\` = ?`,
        [userId]
      );

      // 5. Deletar contatos, produtos e campanhas
      await transactionalEntityManager.query(
        `DELETE FROM \`contacts\` WHERE \`userId\` = ?`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`products\` WHERE \`userId\` = ?`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`campaigns\` WHERE \`userId\` = ?`,
        [userId]
      );

      // 6. Deletar pixels, grupos, categorias e tags
      await transactionalEntityManager.query(
        `DELETE FROM \`pixels\` WHERE \`userId\` = ?`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`groups\` WHERE \`userId\` = ?`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`categories\` WHERE \`userId\` = ?`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`tags\` WHERE \`userId\` = ?`,
        [userId]
      );

      // 7. Deletar integrações (conexões)
      await transactionalEntityManager.query(
        `DELETE FROM \`email_connections\` WHERE \`userId\` = ?`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`nuvemshop_connections\` WHERE \`userId\` = ?`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`shopify_connections\` WHERE \`userId\` = ?`,
        [userId]
      );

      await transactionalEntityManager.query(
        `DELETE FROM \`vtex_connections\` WHERE \`userId\` = ?`,
        [userId]
      );

      // Resetar contador de e-mails enviados no mês se desejar (opcional, vamos manter por segurança de limite)
      // await transactionalEntityManager.update(User, userId, { emailsSentMonth: 0 });
    });
  }

  // ── Twilio WhatsApp por usuário ──────────────────────────────────────────────

  /**
   * Retorna as credenciais Twilio do usuário (oculta o authToken completo).
   */
  async getTwilioConfig(userId: number): Promise<any> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const hasToken = !!user.twilioAuthToken;
    return {
      accountSid: user.twilioAccountSid || null,
      // Retorna apenas os últimos 4 chars para confirmação visual, sem expor
      authTokenMask: hasToken ? `****${user.twilioAuthToken?.slice(-4)}` : null,
      whatsappFrom: user.twilioWhatsappFrom || null,
      configured: !!(user.twilioAccountSid && user.twilioAuthToken && user.twilioWhatsappFrom),
    };
  }

  /**
   * Persiste as credenciais Twilio da subconta do usuário.
   */
  async saveTwilioConfig(
    userId: number,
    dto: { accountSid: string; authToken: string; whatsappFrom: string },
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    user.twilioAccountSid = dto.accountSid?.trim() || undefined;
    const normalizedToken = dto.authToken?.trim();
    if (normalizedToken && !normalizedToken.startsWith('****')) {
      user.twilioAuthToken = this.twilioService.encryptAuthToken(normalizedToken);
    } else if (!user.twilioAuthToken) {
      user.twilioAuthToken = undefined;
    }
    user.twilioWhatsappFrom = dto.whatsappFrom?.trim() || undefined;

    await this.userRepository.save(user);
    this.logger.log(`[TWILIO] Credenciais salvas para o usuário ${userId}`);
    return { success: true, message: 'Credenciais Twilio salvas com sucesso.' };
  }

  /**
   * Cria uma subconta Twilio usando a conta principal e já salva as credenciais no usuário.
   * O número de WhatsApp deve ser informado manualmente após a criação da subconta.
   */
  async createTwilioSubaccount(
    userId: number,
    dto: { friendlyName: string; whatsappFrom: string },
  ): Promise<{ success: boolean; accountSid?: string; message: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const result = await this.twilioService.createSubaccount(dto.friendlyName || user.email);
    if (!result) {
      return {
        success: false,
        message: 'Falha ao criar subconta na Twilio. Verifique as credenciais da conta principal no .env.',
      };
    }

    user.twilioAccountSid = result.sid;
    user.twilioAuthToken = this.twilioService.encryptAuthToken(result.authToken);
    user.twilioWhatsappFrom = dto.whatsappFrom?.trim() || undefined;
    await this.userRepository.save(user);

    this.logger.log(`[TWILIO] Subconta criada e salva para o usuário ${userId}: ${result.sid}`);
    return {
      success: true,
      accountSid: result.sid,
      message: `Subconta criada com sucesso! SID: ${result.sid}. Número salvo: ${dto.whatsappFrom || 'não informado'}`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────────

}
