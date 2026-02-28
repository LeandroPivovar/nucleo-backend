import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Campaign } from '../../entities/campaign.entity';
import { ZenviaService } from '../../zenvia/zenvia.service';
import { ContactsService } from '../../contacts/contacts.service';
import { EmailService } from '../../email/email.service';
import { UserUsage } from '../../entities/user-usage.entity';
import { User } from '../../entities/user.entity';
import { Subscription } from '../../entities/subscription.entity';

@Injectable()
export class CampaignSchedulerService {
    private readonly logger = new Logger(CampaignSchedulerService.name);

    constructor(
        @InjectRepository(Campaign)
        private campaignsRepository: Repository<Campaign>,
        @InjectRepository(UserUsage)
        private userUsageRepository: Repository<UserUsage>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Subscription)
        private subscriptionRepository: Repository<Subscription>,
        private zenviaService: ZenviaService,
        private contactsService: ContactsService,
        private emailService: EmailService
    ) { }

    @Cron(CronExpression.EVERY_MINUTE)
    async handleScheduledCampaigns() {
        this.logger.debug('Checking for scheduled campaigns...');

        const now = new Date();
        const pendingCampaigns = await this.campaignsRepository.find({
            where: {
                status: 'agendada',
                scheduledAt: LessThanOrEqual(now),
            },
        });

        if (pendingCampaigns.length === 0) {
            return;
        }

        this.logger.log(`Found ${pendingCampaigns.length} campaigns to dispatch.`);

        for (const campaign of pendingCampaigns) {
            await this.processCampaign(campaign);
        }
    }

    async processCampaign(campaign: Campaign) {
        this.logger.log(`Processing campaign [ID: ${campaign.id}] - Channel: ${campaign.channel}`);

        // Update status to 'ativa' while processing
        campaign.status = 'ativa';
        await this.campaignsRepository.save(campaign);

        try {
            // Load target contacts based on config
            const groups = campaign.config?.groups || [];
            const segmentations = campaign.config?.segmentations || [];

            // Fetch all contacts for the user with their segmentations
            const allContacts = await this.contactsService.findAll(campaign.userId);

            // Logic compatible with frontend filtering
            const targetContacts = allContacts.filter(contact => {
                // If groups are specified, check if contact belongs to one
                if (groups.length > 0 && contact.group && groups.includes(contact.group.name)) {
                    return true;
                }

                // If segmentations are specified
                if (segmentations.length > 0) {
                    // Direct matches
                    const hasSegmentation = contact.contactSegmentations?.some(cs =>
                        segmentations.includes(cs.segmentationId)
                    );
                    if (hasSegmentation) return true;

                    // Dynamic logic
                    for (const segId of segmentations) {
                        if (segId === 'by_state' || segId.startsWith('state_')) {
                            if (contact.state) return true;
                        }

                        if (segId === 'lead_captured') {
                            if (contact.status?.toLowerCase() === 'lead') return true;
                        }

                        if (segId === 'by_purchase_count' || segId === 'inactive_customers' || segId === 'high_ticket') {
                            const status = contact.status?.toLowerCase();
                            if (status === 'customer' || status === 'cliente') return true;
                        }
                    }
                }

                return false;
            });

            this.logger.log(`Campaign [${campaign.id}] has ${targetContacts.length} target contacts.`);

            let successCount = 0;

            for (const contact of targetContacts) {
                let sent = false;

                if (campaign.channel === 'whatsapp' || campaign.channel === 'sms') {
                    if (!contact.phone) {
                        this.logger.warn(`Contact ${contact.id} has no phone number. Skipping.`);
                        continue;
                    }

                    const messageContent = campaign.config?.email?.content || 'Olá! Temos uma novidade para você.';

                    if (campaign.channel === 'whatsapp') {
                        sent = await this.zenviaService.sendWhatsapp(contact.name || 'Contato CRM', contact.phone, messageContent);
                    } else if (campaign.channel === 'sms') {
                        sent = await this.zenviaService.sendSms(contact.name || 'Contato CRM', contact.phone, messageContent);
                    }
                } else if (campaign.channel === 'email') {
                    if (!contact.email) {
                        this.logger.warn(`Contact ${contact.id} has no email address. Skipping.`);
                        continue;
                    }

                    const subject = campaign.config?.email?.subject || 'Nova Campanha';
                    const content = campaign.config?.email?.content || '';

                    // The simplest path uses the fallback email service assuming the User has SMTP configured.
                    // A proper implementation would fetch the EmailConnection of the user.
                    try {
                        await this.emailService.sendEmail({
                            to: contact.email,
                            subject: subject,
                            html: content,
                            text: content.replace(/<[^>]*>?/gm, '') // Strip HTML tags for plain text fallback
                        });
                        sent = true;
                    } catch (e) {
                        this.logger.error(`Failed to send email to ${contact.email}`);
                        sent = false;
                    }
                }

                if (sent) {
                    successCount++;
                }
            }

            // After loop, finalize campaign metrics
            campaign.sentCount = (campaign.sentCount || 0) + successCount;
            campaign.recipientsCount = targetContacts.length;
            campaign.status = 'finalizada'; // Mark as done for simple dispatch

            await this.campaignsRepository.save(campaign);

            // Fetch Plan Limits
            const subscription = await this.subscriptionRepository.findOne({
                where: { userId: campaign.userId, status: 'active' },
                relations: ['plan'],
            });
            const planEmailsLimit = subscription?.plan?.limits?.emails || 0;
            const planSmsLimit = subscription?.plan?.limits?.sms || 0;

            // Increment Sender Usage
            const currentMonthYear = new Date().toISOString().slice(0, 7);
            let usage = await this.userUsageRepository.findOne({
                where: { userId: campaign.userId, monthYear: currentMonthYear }
            });
            if (!usage) {
                usage = this.userUsageRepository.create({
                    userId: campaign.userId,
                    monthYear: currentMonthYear,
                });
            }

            const user = await this.userRepository.findOne({ where: { id: campaign.userId } });

            if (campaign.channel === 'email') {
                const currentUsage = Number(usage.emailsSent) || 0;
                const newUsage = currentUsage + successCount;
                if (newUsage > planEmailsLimit && user && user.extraEmailsBalance > 0) {
                    const exceededAmount = newUsage - Math.max(currentUsage, planEmailsLimit);
                    user.extraEmailsBalance = Math.max(0, user.extraEmailsBalance - exceededAmount);
                    await this.userRepository.save(user);
                }
                usage.emailsSent = newUsage;
            } else if (campaign.channel === 'sms') {
                const currentUsage = Number(usage.smsSent) || 0;
                const newUsage = currentUsage + successCount;
                if (newUsage > planSmsLimit && user && user.extraSmsBalance > 0) {
                    const exceededAmount = newUsage - Math.max(currentUsage, planSmsLimit);
                    user.extraSmsBalance = Math.max(0, user.extraSmsBalance - exceededAmount);
                    await this.userRepository.save(user);
                }
                usage.smsSent = newUsage;
            } else if (campaign.channel === 'whatsapp') {
                usage.whatsappSent = (Number(usage.whatsappSent) || 0) + successCount;
            }

            await this.userUsageRepository.save(usage);

            this.logger.log(`Campaign [${campaign.id}] finished. Successfully sent: ${successCount}/${targetContacts.length}.`);

        } catch (error: any) {
            this.logger.error(`Error processing campaign [ID: ${campaign.id}]: ${error.message}`);
            // If failed brutally, leave it as 'ativa' or set to 'erro' (not in enum though)
        }
    }
}
