import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Referral } from '../entities/referral.entity';
import { ReferralCommission } from '../entities/referral-commission.entity';
import { ReferralRewardConfig } from '../entities/referral-reward-config.entity';

@Injectable()
export class ReferralsService {
    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Referral)
        private referralRepository: Repository<Referral>,
        @InjectRepository(ReferralCommission)
        private referralCommissionRepository: Repository<ReferralCommission>,
        @InjectRepository(ReferralRewardConfig)
        private referralRewardConfigRepository: Repository<ReferralRewardConfig>,
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

    // --- Admin Methods ---

    async getAdminStats() {
        const totalReferrals = await this.referralRepository.count();
        const convertedReferrals = await this.referralRepository.count({ where: { status: 'converted' } });
        const conversionRate = totalReferrals > 0 ? (convertedReferrals / totalReferrals) * 100 : 0;

        const commissions = await this.referralCommissionRepository.find();
        const revenueGenerated = commissions.reduce((sum, c) => sum + Number(c.amount) * 10, 0); // Mock: Assume revenue is 10x commission
        const pendingCommissions = commissions
            .filter(c => c.status === 'pending' || c.status === 'approved')
            .reduce((sum, c) => sum + Number(c.amount), 0);
        const paidCommissions = commissions
            .filter(c => c.status === 'paid')
            .reduce((sum, c) => sum + Number(c.amount), 0);

        return {
            totalReferrals,
            convertedReferrals,
            conversionRate,
            revenueGenerated,
            pendingCommissions,
            paidCommissions,
        };
    }

    async getAdminList(query: any) {
        const { status, referrerId, search } = query;
        const qb = this.referralRepository.createQueryBuilder('referral')
            .leftJoinAndSelect('referral.referrer', 'referrer')
            .leftJoinAndSelect('referral.referred', 'referred')
            .orderBy('referral.createdAt', 'DESC');

        if (status) {
            qb.andWhere('referral.status = :status', { status });
        }

        if (referrerId) {
            qb.andWhere('referral.referrerId = :referrerId', { referrerId });
        }

        if (search) {
            qb.andWhere('(referral.referredName LIKE :search OR referral.email LIKE :search OR referrer.firstName LIKE :search)', { search: `%${search}%` });
        }

        const referrals = await qb.getMany();

        // Map to include more details
        return Promise.all(referrals.map(async (ref) => {
            const commissions = await this.referralCommissionRepository.find({
                where: { referredId: ref.referredId, referrerId: ref.referrerId }
            });
            const totalCommission = commissions.reduce((sum, c) => sum + Number(c.amount), 0);

            return {
                ...ref,
                referrerName: ref.referrer ? `${ref.referrer.firstName} ${ref.referrer.lastName}` : 'N/A',
                referrerCompany: 'Empresa do Indicador', // Placeholder
                commissionGenerated: totalCommission,
                paymentStatus: commissions.length > 0 ? commissions[0].status : 'N/A',
            };
        }));
    }

    async updateReferralStatus(id: number, status: string) {
        const referral = await this.referralRepository.findOne({ where: { id } });
        if (!referral) throw new NotFoundException('IndicaÃ§Ã£o nÃ£o encontrada');

        referral.status = status as any;
        return this.referralRepository.save(referral);
    }

    async getAdminCommissions(query: any) {
        const { status, referrerId } = query;
        const qb = this.referralCommissionRepository.createQueryBuilder('commission')
            .leftJoinAndSelect('commission.referrer', 'referrer')
            .leftJoinAndSelect('commission.referred', 'referred')
            .leftJoinAndSelect('commission.subscription', 'subscription')
            .orderBy('commission.createdAt', 'DESC');

        if (status) {
            qb.andWhere('commission.status = :status', { status });
        }

        if (referrerId) {
            qb.andWhere('commission.referrerId = :referrerId', { referrerId });
        }

        return qb.getMany();
    }

    async updateCommissionStatus(id: number, status: string) {
        const commission = await this.referralCommissionRepository.findOne({ where: { id } });
        if (!commission) throw new NotFoundException('ComissÃ£o nÃ£o encontrada');

        commission.status = status as any;
        if (status === 'paid') {
            commission.paymentDate = new Date();
        }
        return this.referralCommissionRepository.save(commission);
    }

    async getRanking() {
        const ranking = await this.referralRepository.createQueryBuilder('referral')
            .select('referral.referrerId', 'referrerId')
            .addSelect('COUNT(referral.id)', 'totalReferrals')
            .addSelect('COUNT(CASE WHEN referral.status = \'converted\' THEN 1 END)', 'conversions')
            .leftJoin('referral.referrer', 'referrer')
            .addSelect('referrer.firstName', 'firstName')
            .addSelect('referrer.lastName', 'lastName')
            .groupBy('referral.referrerId')
            .addGroupBy('referrer.firstName')
            .addGroupBy('referrer.lastName')
            .orderBy('conversions', 'DESC')
            .getRawMany();

        return ranking.map(item => ({
            referrerId: item.referrerId,
            name: `${item.firstName} ${item.lastName}`,
            totalReferrals: parseInt(item.totalReferrals),
            conversions: parseInt(item.conversions),
            conversionRate: item.totalReferrals > 0 ? (parseInt(item.conversions) / parseInt(item.totalReferrals)) * 100 : 0,
            revenueGenerated: 0, // Implementar lÃ³gica de receita real se necessÃ¡rio
            accumulatedCommission: 0, // Implementar lÃ³gica de comissÃ£o real se necessÃ¡rio
        }));
    }

    async getRewardConfig() {
        return this.referralRewardConfigRepository.find();
    }

    async updateRewardConfig(id: number, data: any) {
        let config;
        if (id) {
            config = await this.referralRewardConfigRepository.findOne({ where: { id } });
            if (!config) throw new NotFoundException('ConfiguraÃ§Ã£o nÃ£o encontrada');
            Object.assign(config, data);
        } else {
            config = this.referralRewardConfigRepository.create(data);
        }
        return this.referralRewardConfigRepository.save(config);
    }

    // New: User specific referral management
    async getAdminUserList() {
        return this.userRepository.find({
            select: ['id', 'firstName', 'lastName', 'email', 'referralPercentage', 'referralCode'],
            order: { firstName: 'ASC' }
        });
    }

    async updateAdminUserPercentage(userId: number, percentage: number) {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('Usuário não encontrado');

        user.referralPercentage = percentage;
        return this.userRepository.save(user);
    }
}
