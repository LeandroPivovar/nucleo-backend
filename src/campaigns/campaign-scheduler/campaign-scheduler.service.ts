import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Campaign } from '../../entities/campaign.entity';
import { ZenviaService } from '../../zenvia/zenvia.service';
import { ContactsService } from '../../contacts/contacts.service';
import { EmailService } from '../../email/email.service';

@Injectable()
export class CampaignSchedulerService {
    private readonly logger = new Logger(CampaignSchedulerService.name);

    constructor(
        @InjectRepository(Campaign)
        private campaignsRepository: Repository<Campaign>,
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

    private async processCampaign(campaign: Campaign) {
        this.logger.log(`Processing campaign [ID: ${campaign.id}] - Channel: ${campaign.channel}`);

        // Update status to 'ativa' while processing
        campaign.status = 'ativa';
        await this.campaignsRepository.save(campaign);

        try {
            // Load target contacts based on config
            const groups = campaign.config?.groups || [];

            // In a real scenario, you'd fetch contacts uniquely matching these `groups` or `segmentations`.
            // For this quick implementation, we will fetch contacts by userId since we need to know who to send to.
            const allContacts = await this.contactsService.findAll(campaign.userId);

            // Basic filtering if groups are specified
            const targetContacts = groups.length > 0
                ? allContacts.filter(c => c.group && groups.includes(c.group.name))
                : allContacts;

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
                        sent = await this.zenviaService.sendWhatsapp(contact.phone, messageContent);
                    } else if (campaign.channel === 'sms') {
                        sent = await this.zenviaService.sendSms(contact.phone, messageContent);
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
            this.logger.log(`Campaign [${campaign.id}] finished. Successfully sent: ${successCount}/${targetContacts.length}.`);

        } catch (error: any) {
            this.logger.error(`Error processing campaign [ID: ${campaign.id}]: ${error.message}`);
            // If failed brutally, leave it as 'ativa' or set to 'erro' (not in enum though)
        }
    }
}
