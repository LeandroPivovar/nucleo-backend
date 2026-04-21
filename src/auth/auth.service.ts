import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { PasswordReset } from '../entities/password-reset.entity';
import { EmailVerification } from '../entities/email-verification.entity';
import { Referral } from '../entities/referral.entity';
import { LoginAttempt } from '../entities/login-attempt.entity';
import { RegisterDto } from './dto/register.dto';
import axios from 'axios';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { EmailHelper } from '../email/email.helper';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { NotificationType } from '../entities/notification.entity';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(PasswordReset)
    private passwordResetRepository: Repository<PasswordReset>,
    @InjectRepository(EmailVerification)
    private emailVerificationRepository: Repository<EmailVerification>,
    @InjectRepository(Referral)
    private referralRepository: Repository<Referral>,
    @InjectRepository(LoginAttempt)
    private loginAttemptRepository: Repository<LoginAttempt>,
    private jwtService: JwtService,
    private emailHelper: EmailHelper,
    private notificationsService: NotificationsService,
    private subscriptionsService: SubscriptionsService,
    private campaignsService: CampaignsService,
  ) { }

  /**
   * Formata a resposta do usuário incluindo o nome do plano atual
   */
  private async formatUserResponse(user: User) {
    const subscription = await this.subscriptionsService.getCurrentSubscription(user.id);
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      twoFactorEnabled: user.twoFactorEnabled,
      planName: subscription?.plan?.name || 'Plano gratuito',
      document: user.document,
      address: user.address,
      postalCode: user.postalCode,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Gera um token único para verificação de e-mail
   */
  private generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName, document, address, referralCode } = registerDto;

    // Verificar se o usuário já existe
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('E-mail já está em uso');
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Gerar código de indicação único para o novo usuário
    let newUserReferralCode = '';
    let isUnique = false;
    while (!isUnique) {
      newUserReferralCode = this.generateReferralCode();
      const existingCode = await this.userRepository.findOne({ where: { referralCode: newUserReferralCode } });
      if (!existingCode) isUnique = true;
    }

    // Verificar se foi indicado por alguém
    let referredById: number | null = null;
    let referrer: User | null = null;
    if (referralCode) {
      referrer = await this.userRepository.findOne({ where: { referralCode } });
      if (referrer) {
        referredById = referrer.id;
      }
    }

    // Criar usuário (ativo por padrão para não exigir verificação por e-mail)
    const user: User = this.userRepository.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      document,
      address,
      referralCode: newUserReferralCode,
      referredById: referredById ?? undefined,
      active: false, // Conta inativa até verificação
    });

    const savedUser = await this.userRepository.save(user);

    // Se houver indicação, criar registro na tabela referrals
    if (referrer) {
      const referral = this.referralRepository.create({
        referrerId: referrer.id,
        referredId: savedUser.id,
        status: 'active',
      });
      await this.referralRepository.save(referral);
    }

    // Gerar token de verificação
    const token = this.generateVerificationToken();

    // Criar registro de verificação
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Expira em 24 horas

    const emailVerification = this.emailVerificationRepository.create({
      userId: savedUser.id,
      token,
      expiresAt,
    });

    await this.emailVerificationRepository.save(emailVerification);

    // Enviar e-mail de verificação
    try {
      await this.emailHelper.sendEmailVerification(
        savedUser.email,
        token,
        `${savedUser.firstName} ${savedUser.lastName}`,
      );
    } catch (error) {
      // Se falhar ao enviar e-mail, remover o registro de verificação e o usuário
      await this.emailVerificationRepository.remove(emailVerification);
      await this.userRepository.remove(savedUser);
      throw new BadRequestException('Erro ao enviar e-mail de verificação. Tente novamente mais tarde.');
    }

    // Criar objeto do usuário para retorno (sem senha)
    const userResponse = await this.formatUserResponse(savedUser);

    return {
      message: 'Conta criada com sucesso! Verifique seu e-mail para ativar a conta.',
      user: userResponse,
    };
  }

  async login(loginDto: LoginDto, ip?: string) {
    const { email, password } = loginDto;
    let user: User | null = null;
    let geo: { city: string | null; country: string | null } = { city: null, country: null };

    if (ip) {
      geo = await this.getLocationFromIp(ip);
    }

    try {
      // Buscar usuário
      user = await this.userRepository.findOne({
        where: { email },
      });

      if (!user) {
        await this.recordAttempt(null, email, ip || 'unknown', geo, false);
        throw new UnauthorizedException('Credenciais inválidas');
      }

      // Verificar senha
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        await this.recordAttempt(user.id, email, ip || 'unknown', geo, false);
        await this.notifyFailedLogin(user, ip || 'unknown', geo);
        throw new UnauthorizedException('Credenciais inválidas');
      }

      // Verificar se a conta está ativa
      if (!user.active) {
        await this.recordAttempt(user.id, email, ip || 'unknown', geo, false);
        await this.notifyFailedLogin(user, ip || 'unknown', geo, 'Conta inativa');
        throw new UnauthorizedException('Conta não verificada. Verifique seu e-mail para ativar sua conta.');
      }

      // Verificar se 2FA está ativado
      if (user.twoFactorEnabled) {
        const code = this.generate2faCode();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Expira em 10 minutos

        user.twoFactorCode = code;
        user.twoFactorExpires = expiresAt;
        await this.userRepository.save(user);

        // Enviar e-mail com o código
        await this.emailHelper.sendTwoFactorCode(
          user.email,
          code,
          `${user.firstName} ${user.lastName}`
        );

        // Registro parcial - sucesso na senha, mas aguardando 2FA
        // Não gravamos como sucesso final ainda? O usuário disse se teve uso de 2fa ou não.
        // Vou gravar quando o login for FINALIZADO.
        // No entanto, o login inicial é uma "tentativa".
        return {
          twoFactorRequired: true,
          email: user.email,
        };
      }

      // Sucesso sem 2FA
      user.lastLoginAt = new Date();
      await this.userRepository.save(user);

      await this.recordAttempt(user.id, email, ip || 'unknown', geo, true, false);

      // Verificar faturas pendentes de forma assíncrona para não atrasar o login
      this.subscriptionsService.checkAndNotifyUpcomingInvoice(user.id).catch(e =>
        console.error('Erro ao verificar faturas no login:', e)
      );

      // Verificar desempenho de campanhas
      this.campaignsService.checkAndNotifyPerformance(user.id).catch(e =>
        console.error('Erro ao verificar desempenho de campanhas no login:', e)
      );

      // Gerar token JWT
      const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });

      return {
        user: await this.formatUserResponse(user),
        token,
      };
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        await this.recordAttempt(user?.id || null, email, ip || 'unknown', geo, false);
      }
      throw error;
    }
  }

  /**
   * Verifica o código de 2FA e retorna o token JWT
   */
  async verify2fa(verify2faDto: Verify2faDto, ip?: string) {
    const { email, code } = verify2faDto;
    let geo: { city: string | null; country: string | null } = { city: null, country: null };

    if (ip) {
      geo = await this.getLocationFromIp(ip);
    }

    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      await this.recordAttempt(null, email, ip || 'unknown', geo, false, true);
      throw new UnauthorizedException('Usuário não encontrado');
    }

    if (!user.twoFactorCode || user.twoFactorCode !== code) {
      await this.recordAttempt(user.id, email, ip || 'unknown', geo, false, true);
      await this.notifyFailedLogin(user, ip || 'unknown', geo, 'Código 2FA inválido');
      throw new UnauthorizedException('Código de segurança inválido');
    }

    if (!user.twoFactorExpires || new Date() > user.twoFactorExpires) {
      await this.recordAttempt(user.id, email, ip || 'unknown', geo, false, true);
      await this.notifyFailedLogin(user, ip || 'unknown', geo, 'Código 2FA expirado');
      throw new UnauthorizedException('Código de segurança expirado');
    }

    // Limpar código após uso bem-sucedido e atualizar último login
    user.twoFactorCode = undefined;
    user.twoFactorExpires = undefined;
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    // Sucesso com 2FA
    await this.recordAttempt(user.id, email, ip || 'unknown', geo, true, true);

    // Verificar faturas pendentes
    this.subscriptionsService.checkAndNotifyUpcomingInvoice(user.id).catch(e =>
      console.error('Erro ao verificar faturas no login 2FA:', e)
    );

    // Verificar desempenho de campanhas
    this.campaignsService.checkAndNotifyPerformance(user.id).catch(e =>
      console.error('Erro ao verificar desempenho de campanhas no login 2FA:', e)
    );

    // Gerar token JWT
    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });

    return {
      user: await this.formatUserResponse(user),
      token,
    };
  }

  /**
   * Gera um código de 6 dígitos para 2FA
   */
  private generate2faCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Verifica o e-mail e ativa a conta
   */
  async verifyEmail(token: string): Promise<{ message: string }> {
    // Buscar verificação
    const emailVerification = await this.emailVerificationRepository.findOne({
      where: { token, used: false },
      relations: ['user'],
    });

    if (!emailVerification) {
      throw new BadRequestException('Token de verificação inválido ou já utilizado');
    }

    // Verificar se expirou
    if (new Date() > emailVerification.expiresAt) {
      throw new BadRequestException('Token de verificação expirado. Solicite um novo e-mail de verificação.');
    }

    // Ativar conta do usuário
    emailVerification.user.active = true;
    await this.userRepository.save(emailVerification.user);

    // Marcar token como usado
    emailVerification.used = true;
    await this.emailVerificationRepository.save(emailVerification);

    return { message: 'E-mail verificado com sucesso! Sua conta foi ativada.' };
  }

  /**
   * Reenvia e-mail de verificação
   */
  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    // Buscar usuário
    const user = await this.userRepository.findOne({
      where: { email },
    });

    // Por segurança, não revelamos se o e-mail existe ou não
    if (!user) {
      return { message: 'Se o e-mail existir e a conta não estiver verificada, um novo e-mail foi enviado' };
    }

    // Se já estiver ativo, não precisa reenviar
    if (user.active) {
      return { message: 'Conta já está verificada' };
    }

    // Invalidar tokens anteriores não utilizados
    await this.emailVerificationRepository.update(
      { userId: user.id, used: false },
      { used: true },
    );

    // Gerar novo token
    const token = this.generateVerificationToken();

    // Criar novo registro de verificação
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const emailVerification = this.emailVerificationRepository.create({
      userId: user.id,
      token,
      expiresAt,
    });

    await this.emailVerificationRepository.save(emailVerification);

    // Enviar e-mail
    try {
      await this.emailHelper.sendEmailVerification(
        user.email,
        token,
        `${user.firstName} ${user.lastName}`,
      );
    } catch (error) {
      await this.emailVerificationRepository.remove(emailVerification);
      throw new BadRequestException('Erro ao enviar e-mail de verificação. Tente novamente mais tarde.');
    }

    return { message: 'Se o e-mail existir e a conta não estiver verificada, um novo e-mail foi enviado' };
  }

  /**
   * Gera um código de 6 dígitos para recuperação de senha
   */
  private generateResetCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Solicita recuperação de senha - envia código por e-mail
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;

    // Buscar usuário
    const user = await this.userRepository.findOne({
      where: { email },
    });

    // Por segurança, não revelamos se o e-mail existe ou não
    if (!user) {
      return { message: 'Se o e-mail existir, um código foi enviado' };
    }

    // Invalidar códigos anteriores não utilizados
    await this.passwordResetRepository.update(
      { userId: user.id, used: false },
      { used: true },
    );

    // Gerar código de 6 dígitos
    const code = this.generateResetCode();

    // Criar registro de reset
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15); // Expira em 15 minutos

    const passwordReset = this.passwordResetRepository.create({
      userId: user.id,
      code,
      expiresAt,
    });

    await this.passwordResetRepository.save(passwordReset);

    // Enviar e-mail com código
    try {
      await this.emailHelper.sendPasswordResetCode(
        user.email,
        code,
        `${user.firstName} ${user.lastName}`,
      );
    } catch (error) {
      // Se falhar ao enviar e-mail, remover o código criado
      await this.passwordResetRepository.remove(passwordReset);

      // Log do erro para debug
      console.error('Erro ao enviar e-mail de recuperação:', error);

      // Retornar mensagem mais específica se possível
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(
        `Erro ao enviar e-mail: ${errorMessage}. Verifique a configuração SMTP.`
      );
    }

    return { message: 'Se o e-mail existir, um código foi enviado' };
  }

  /**
   * Verifica se o código de recuperação é válido
   */
  async verifyResetCode(verifyResetCodeDto: VerifyResetCodeDto): Promise<{ valid: boolean }> {
    const { email, code } = verifyResetCodeDto;

    // Buscar usuário
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      return { valid: false };
    }

    // Buscar código válido
    const passwordReset = await this.passwordResetRepository.findOne({
      where: {
        userId: user.id,
        code,
        used: false,
      },
      order: { createdAt: 'DESC' },
    });

    if (!passwordReset) {
      return { valid: false };
    }

    // Verificar se expirou
    if (new Date() > passwordReset.expiresAt) {
      return { valid: false };
    }

    return { valid: true };
  }

  /**
   * Redefine a senha usando o código de recuperação
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const { email, code, newPassword, confirmPassword } = resetPasswordDto;

    // Validar confirmação de senha
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('As senhas não coincidem');
    }

    // Buscar usuário
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    // Buscar código válido
    const passwordReset = await this.passwordResetRepository.findOne({
      where: {
        userId: user.id,
        code,
        used: false,
      },
      order: { createdAt: 'DESC' },
    });

    if (!passwordReset) {
      throw new BadRequestException('Código inválido ou já utilizado');
    }

    // Verificar se expirou
    if (new Date() > passwordReset.expiresAt) {
      throw new BadRequestException('Código expirado. Solicite um novo código.');
    }

    // Hash da nova senha
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Atualizar senha do usuário
    user.password = hashedPassword;
    await this.userRepository.save(user);

    // Marcar código como usado
    passwordReset.used = true;
    await this.passwordResetRepository.save(passwordReset);

    // Invalidar outros códigos não utilizados
    await this.passwordResetRepository.update(
      { userId: user.id, used: false },
      { used: true },
    );

    return { message: 'Senha redefinida com sucesso' };
  }

  /**
   * Gera um código de indicação único de 6 caracteres (alfanumérico)
   */
  private generateReferralCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private async recordAttempt(
    userId: number | null,
    email: string,
    ip: string,
    geo: { city: string | null; country: string | null },
    success: boolean,
    twoFactorUsed: boolean = false
  ) {
    try {
      const attempt = this.loginAttemptRepository.create({
        userId: userId || undefined,
        email,
        ip,
        city: geo.city || undefined,
        country: geo.country || undefined,
        success,
        twoFactorUsed,
      });
      await this.loginAttemptRepository.save(attempt);
    } catch (error) {
      console.error('Erro ao gravar tentativa de login:', error);
    }
  }

  private async getLocationFromIp(ip: string): Promise<{ city: string | null; country: string | null }> {
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip === 'unknown') {
      return { city: 'Localhost', country: 'Localhost' };
    }

    try {
      // Adicionar timeout para não bloquear o login se o serviço estiver lento ou inacessível
      const response = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 3000 });
      if (response.data && response.data.status === 'success') {
        return {
          city: response.data.city,
          country: response.data.country,
        };
      }
    } catch (error) {
      // Logar apenas o código do erro para não poluir o console com o stack trace do Axios
      console.error(`Erro ao obter localização do IP (${ip}): ${error.code || error.message}`);
    }
    return { city: null, country: null };
  }

  private async notifyFailedLogin(user: User, ip: string, geo: { city: string | null; country: string | null }, reason?: string) {
    try {
      const location = (geo.city && geo.country) ? `${geo.city}, ${geo.country}` : (ip === '::1' || ip === '127.0.0.1') ? 'Localhost' : 'Localização desconhecida';
      const time = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      await this.notificationsService.create({
        userId: user.id,
        title: '⚠️ Tentativa de Login Negada',
        message: `Uma tentativa de login em sua conta foi bloqueada.\n\n` +
          `📍 Localização: ${location}\n` +
          `🌐 IP: ${ip}\n` +
          `⏰ Horário: ${time}\n` +
          (reason ? `❌ Motivo: ${reason}\n` : '') +
          `\nSe não foi você, recomendamos alterar sua senha imediatamente.`,
        type: NotificationType.SECURITY,
      });
    } catch (error) {
      console.error('Erro ao enviar notificação de falha de login:', error);
    }
  }
}

