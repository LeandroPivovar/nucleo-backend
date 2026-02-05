import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';
import { User } from '../entities/user.entity';
import { Contact } from '../entities/contact.entity';

@Injectable()
export class SubscriptionsService {
    constructor(
        @InjectRepository(Subscription)
        private subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Plan)
        private planRepository: Repository<Plan>,
        @InjectRepository(Invoice)
        private invoiceRepository: Repository<Invoice>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Contact)
        private contactRepository: Repository<Contact>,
    ) { }

    async getPlans(): Promise<Plan[]> {
        return this.planRepository.find({ where: { active: true } });
    }

    async getCurrentSubscription(userId: number) {
        const subscription = await this.subscriptionRepository.findOne({
            where: { userId, status: 'active' },
            relations: ['plan'],
            order: { createdAt: 'DESC' }, // Get most recent
        });

        if (!subscription) {
            // If no active subscription, try to return the free plan or null
            return null;
        }

        return subscription;
    }

    async getInvoices(userId: number) {
        return this.invoiceRepository.find({
            where: { userId },
            order: { createdAt: 'DESC' },
        });
    }

    async getDashboardStats(userId: number) {
        const subscription = await this.getCurrentSubscription(userId);
        const contactsCount = await this.contactRepository.count({ where: { userId } });
        const user = await this.userRepository.findOne({ where: { id: userId } });
        const emailsSent = user?.emailsSentMonth || 0;

        return {
            contactsUsed: contactsCount,
            contactsLimit: subscription?.plan?.limits?.contacts || 2000,
            emailsSent: emailsSent,
            currentPlan: subscription?.plan?.name || 'Free',
            price: subscription?.plan?.price || 0,
        };
    }
}
