import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Referral } from '../entities/referral.entity';
import { ReferralCommission } from '../entities/referral-commission.entity';

@Injectable()
export class ReferralsService {
    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Referral)
        private referralRepository: Repository<Referral>,
        @InjectRepository(ReferralCommission)
        private referralCommissionRepository: Repository<ReferralCommission>,
    ) { }

    /**
     * Retorna o código de indicação do usuário
     */
    async getMyCode(userId: number) {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('Usuário não encontrado');
        return { referralCode: user.referralCode };
    }

    /**
     * Lista usuários que foram indicados pelo usuário atual
     */
    async getMyReferrals(userId: number) {
        const referrals = await this.referralRepository.find({
            where: { referrerId: userId },
            relations: ['referred'],
            order: { createdAt: 'DESC' },
        });

        const results: any[] = [];
        for (const ref of referrals) {
            // Calcular comissão total deste indicado
            const commissions = await this.referralCommissionRepository.find({
                where: { referredId: ref.referredId, referrerId: userId }
            });
            const totalCommission = commissions.reduce((sum, c) => sum + Number(c.amount), 0);

            results.push({
                id: ref.id,
                name: `${ref.referred.firstName} ${ref.referred.lastName}`,
                email: ref.referred.email,
                signupDate: ref.referred.createdAt,
                status: ref.status === 'active' ? 'Ativo' : ref.status === 'pending' ? 'Trial' : 'Cancelado',
                plan: 'Pro', // Simplificado
                commission: totalCommission,
                commissionStatus: totalCommission > 0 ? 'Pago' : 'Pendente',
            });
        }

        return results;
    }

    /**
     * Retorna estatísticas de indicações
     */
    async getStats(userId: number) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['referralPercentage']
        });

        const referrals = await this.referralRepository.find({
            where: { referrerId: userId },
        });

        const commissions = await this.referralCommissionRepository.find({
            where: { referrerId: userId }
        });

        const totalReferrals = referrals.length;
        const activeReferrals = referrals.filter(r => r.status === 'active').length;
        const totalEarnings = commissions.reduce((sum, c) => sum + Number(c.amount), 0);

        return {
            totalReferrals,
            activeReferrals,
            totalEarnings,
            pendingEarnings: 0, // Implementação futura
            referralPercentage: Number(user?.referralPercentage) || 3.00
        };
    }

    /**
     * Valida um código de indicação e retorna o nome do indicador (Público)
     */
    async validateCode(code: string) {
        const referrer = await this.userRepository.findOne({
            where: { referralCode: code },
            select: ['firstName', 'lastName'],
        });

        if (!referrer) {
            throw new NotFoundException('Código de indicação inválido');
        }

        return {
            referrerName: `${referrer.firstName} ${referrer.lastName}`,
            isValid: true,
        };
    }

    /**
     * Gera um código de indicação único para o usuário atual
     */
    async generateMyCode(userId: number) {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('Usuário não encontrado');

        if (user.referralCode) {
            return { referralCode: user.referralCode };
        }

        // Gerar código único
        let code = '';
        let isUnique = false;
        while (!isUnique) {
            code = this.generateRandomCode();
            const existing = await this.userRepository.findOne({ where: { referralCode: code } });
            if (!existing) isUnique = true;
        }

        user.referralCode = code;
        await this.userRepository.save(user);

        return { referralCode: code };
    }

    private generateRandomCode(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }
}
