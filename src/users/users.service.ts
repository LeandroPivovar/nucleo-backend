import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Plan)
    private planRepository: Repository<Plan>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
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

  async findAllAdmin(): Promise<any[]> {
    const users = await this.userRepository.find({
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

}
