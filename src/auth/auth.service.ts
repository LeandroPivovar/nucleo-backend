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
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailHelper } from '../email/email.helper';
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
    private jwtService: JwtService,
    private emailHelper: EmailHelper,
  ) {}

  /**
   * Gera um token único para verificação de e-mail
   */
  private generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName } = registerDto;

    // Verificar se o usuário já existe
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('E-mail já está em uso');
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Criar usuário (inativo por padrão)
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      active: false, // Conta inativa até verificar e-mail
    });

    const savedUser = await this.userRepository.save(user);

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
      // Se falhar ao enviar e-mail, remover o registro de verificação
      await this.emailVerificationRepository.remove(emailVerification);
      throw new BadRequestException('Erro ao enviar e-mail de verificação. Tente novamente mais tarde.');
    }

    // Remover senha do retorno
    const { password: _, ...userWithoutPassword } = savedUser;

    // NÃO gerar token JWT - usuário precisa verificar e-mail primeiro
    return {
      message: 'Conta criada com sucesso! Verifique seu e-mail para ativar sua conta.',
      user: userWithoutPassword,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Buscar usuário
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Verificar senha
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Verificar se a conta está ativa
    if (!user.active) {
      throw new UnauthorizedException('Conta não verificada. Verifique seu e-mail para ativar sua conta.');
    }

    // Remover senha do retorno
    const { password: _, ...userWithoutPassword } = user;

    // Gerar token JWT
    const token = this.jwtService.sign({ sub: user.id, email: user.email });

    return {
      user: userWithoutPassword,
      token,
    };
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
}

