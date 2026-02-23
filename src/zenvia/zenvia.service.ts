import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ZenviaService {
    private readonly logger = new Logger(ZenviaService.name);
    private apiToken: string;
    private smsFrom: string;
    private whatsappFrom: string;

    constructor(private configService: ConfigService) {
        this.apiToken = this.configService.get<string>('ZENVIA_API_TOKEN', '');
        this.smsFrom = this.configService.get<string>('ZENVIA_SMS_FROM', '');
        this.whatsappFrom = this.configService.get<string>('ZENVIA_WHATSAPP_FROM', '');

        if (!this.apiToken) {
            this.logger.warn('ZENVIA_API_TOKEN is not defined in .env! SMS/WhatsApp will not be sent.');
        }
    }

    private formatPhone(phone: string): string {
        let clean = phone.replace(/\D/g, '');
        // If it's 10 or 11 digits, assume it's a Brazilian number missing the 55 country code
        if (clean.length === 10 || clean.length === 11) {
            clean = '55' + clean;
        }
        return clean;
    }

    async sendSms(to: string, content: string): Promise<boolean> {
        if (!this.apiToken || !this.smsFrom) {
            this.logger.error('Missing Zenvia SMS configuration.');
            return false;
        }

        try {
            const response = await fetch('https://api.zenvia.com/v2/channels/sms/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-TOKEN': this.apiToken,
                },
                body: JSON.stringify({
                    from: this.smsFrom,
                    to: this.formatPhone(to),
                    contents: [
                        {
                            type: 'text',
                            text: content,
                        }
                    ]
                })
            });

            if (!response.ok) {
                const errPayload = await response.text();
                this.logger.error(`Zenvia SMS API Error: ${response.status} - ${errPayload}`);
                return false;
            }

            this.logger.log(`SMS sent successfully to ${to}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send SMS to ${to}: ${error.message}`);
            return false;
        }
    }

    async sendWhatsapp(to: string, content: string): Promise<boolean> {
        if (!this.apiToken || !this.whatsappFrom) {
            this.logger.error('Missing Zenvia Whatsapp configuration.');
            return false;
        }

        try {
            const response = await fetch('https://api.zenvia.com/v2/channels/whatsapp/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-TOKEN': this.apiToken,
                },
                body: JSON.stringify({
                    from: this.whatsappFrom,
                    to: this.formatPhone(to),
                    contents: [
                        {
                            type: 'text',
                            text: content,
                        }
                    ]
                })
            });

            if (!response.ok) {
                const errPayload = await response.text();
                this.logger.error(`Zenvia WhatsApp API Error: ${response.status} - ${errPayload}`);
                return false;
            }

            this.logger.log(`WhatsApp message sent successfully to ${to}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send WhatsApp message to ${to}: ${error.message}`);
            return false;
        }
    }
}
