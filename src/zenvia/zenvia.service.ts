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

    async checkAndCreateContact(name: string, phone: string): Promise<boolean> {
        if (!this.apiToken) return false;

        try {
            const formattedPhone = this.formatPhone(phone);
            this.logger.debug(`Checking if contact ${formattedPhone} exists in Zenvia...`);

            // 1. Check if exists
            const getRes = await fetch(`https://api.zenvia.com/v2/contacts?channels.mobile=${formattedPhone}`, {
                method: 'GET',
                headers: {
                    'X-API-TOKEN': this.apiToken,
                    'Content-Type': 'application/json'
                }
            });

            if (getRes.ok) {
                const data = await getRes.json();
                // Depending on Zenvia list format (array or paginated list)
                const items = Array.isArray(data) ? data : data.content || [];
                if (items.length > 0) {
                    this.logger.debug(`Contact ${formattedPhone} already exists in Zenvia.`);
                    return true;
                }
            }

            // 2. Create if not exists
            this.logger.debug(`Creating contact ${name} (${formattedPhone}) in Zenvia...`);
            const postRes = await fetch('https://api.zenvia.com/v2/contacts', {
                method: 'POST',
                headers: {
                    'X-API-TOKEN': this.apiToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    firstName: name || "Contato CRM",
                    channels: {
                        mobile: formattedPhone,
                        whatsapp: formattedPhone,
                        sms: formattedPhone
                    }
                })
            });

            if (!postRes.ok) {
                const err = await postRes.text();
                this.logger.warn(`Failed to create contact in Zenvia: ${err}`);
                return false;
            }

            this.logger.log(`Successfully created contact ${formattedPhone} in Zenvia.`);
            return true;

        } catch (error: any) {
            this.logger.error(`Error in Zenvia check/create contact: ${error.message}`);
            return false;
        }
    }

    async sendSms(contactName: string, to: string, content: string): Promise<boolean> {
        if (!this.apiToken || !this.smsFrom) {
            this.logger.error('Missing Zenvia SMS configuration.');
            return false;
        }

        try {
            // Guarantee contact exists before sending
            await this.checkAndCreateContact(contactName, to);

            const payload = {
                from: this.smsFrom,
                to: this.formatPhone(to),
                contents: [
                    {
                        type: 'text',
                        text: content,
                    }
                ]
            };

            this.logger.debug(`Zenvia SMS Request Payload: ${JSON.stringify(payload)}`);

            const response = await fetch('https://api.zenvia.com/v2/channels/sms/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-TOKEN': this.apiToken,
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errPayload = await response.text();
                this.logger.error(`Zenvia SMS API Error: ${response.status} - ${errPayload}`);
                return false;
            }

            const successPayload = await response.text();
            this.logger.log(`Zenvia SMS Success Response: ${response.status} - ${successPayload}`);
            this.logger.log(`SMS sent successfully to ${to}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send SMS to ${to}: ${error.message}`);
            return false;
        }
    }

    async sendWhatsapp(contactName: string, to: string, content: string): Promise<boolean> {
        if (!this.apiToken || !this.whatsappFrom) {
            this.logger.error('Missing Zenvia Whatsapp configuration.');
            return false;
        }

        try {
            // Guarantee contact exists before sending
            await this.checkAndCreateContact(contactName, to);

            const payload = {
                from: this.whatsappFrom,
                to: this.formatPhone(to),
                contents: [
                    {
                        type: 'text',
                        text: content,
                    }
                ]
            };

            this.logger.debug(`Zenvia WhatsApp Request Payload: ${JSON.stringify(payload)}`);

            const response = await fetch('https://api.zenvia.com/v2/channels/whatsapp/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-TOKEN': this.apiToken,
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errPayload = await response.text();
                this.logger.error(`Zenvia WhatsApp API Error: ${response.status} - ${errPayload}`);
                return false;
            }

            const successPayload = await response.text();
            this.logger.log(`Zenvia WhatsApp Success Response: ${response.status} - ${successPayload}`);
            this.logger.log(`WhatsApp message sent successfully to ${to}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send WhatsApp message to ${to}: ${error.message}`);
            return false;
        }
    }
}
