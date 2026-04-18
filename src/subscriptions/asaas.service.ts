import { Injectable, Logger } from '@nestjs/common';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class AsaasService {
    private readonly logger = new Logger(AsaasService.name);

    constructor(private readonly settingsService: SystemSettingsService) { }

    private async getClient(): Promise<AxiosInstance> {
        const apiKey = await this.settingsService.get('ASAAS_API_KEY');
        const env = await this.settingsService.get('ASAAS_ENVIRONMENT', 'sandbox');
        const baseUrl = env === 'production' ? 'https://www.asaas.com/api/v3' : 'https://sandbox.asaas.com/api/v3';

        if (!apiKey) {
            this.logger.warn('ASAAS_API_KEY is not set in System Settings');
        }

        return axios.create({
            baseURL: baseUrl,
            headers: {
                'access_token': apiKey,
                'Content-Type': 'application/json',
            },
        });
    }

    async createCustomer(data: {
        name: string;
        email: string;
        phone?: string;
        cpfCnpj: string;
        notificationDisabled?: boolean;
    }) {
        const client = await this.getClient();
        this.logger.log(`Asaas Request [POST /customers]: ${JSON.stringify(data, null, 2)}`);
        try {
            const response = await client.post('/customers', data);
            this.logger.log(`Asaas Response [POST /customers]: ${JSON.stringify(response.data, null, 2)}`);
            return response.data;
        } catch (error: any) {
            const errorMsg = error.response?.data?.errors?.[0]?.description || error.message;
            const errorData = error.response?.data;
            this.logger.error(`Error creating Asaas customer: ${errorMsg}`, JSON.stringify(errorData, null, 2));
            throw new Error(`Erro Asaas: ${errorMsg}`);
        }
    }

    async createSubscription(data: {
        customer: string;
        billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX';
        nextDueDate: string;
        value: number;
        cycle: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
        description?: string;
    }) {
        const client = await this.getClient();
        this.logger.log(`Asaas Request [POST /subscriptions]: ${JSON.stringify(data, null, 2)}`);
        try {
            const response = await client.post('/subscriptions', data);
            this.logger.log(`Asaas Response [POST /subscriptions]: ${JSON.stringify(response.data, null, 2)}`);
            return response.data;
        } catch (error: any) {
            const errorMsg = error.response?.data?.errors?.[0]?.description || error.message;
            const errorData = error.response?.data;
            this.logger.error(`Error creating Asaas subscription: ${errorMsg}`, JSON.stringify(errorData, null, 2));
            throw new Error(`Erro Asaas: ${errorMsg}`);
        }
    }

    async updateSubscriptionCreditCard(id: string, data: any) {
        const client = await this.getClient();
        this.logger.log(`Asaas Request [PUT /subscriptions/${id}/creditCard]: ${JSON.stringify(data, null, 2)}`);
        try {
            const response = await client.put(`/subscriptions/${id}/creditCard`, data);
            this.logger.log(`Asaas Response [PUT /subscriptions/${id}/creditCard]: ${JSON.stringify(response.data, null, 2)}`);
            return response.data;
        } catch (error: any) {
            const errorMsg = error.response?.data?.errors?.[0]?.description || error.message;
            const errorData = error.response?.data;
            this.logger.error(`Error updating Asaas subscription ${id} credit card: ${errorMsg}`, JSON.stringify(errorData, null, 2));
            throw new Error(`Erro Asaas: ${errorMsg}`);
        }
    }

    async getSubscriptionPayments(id: string) {
        const client = await this.getClient();
        try {
            const response = await client.get(`/subscriptions/${id}/payments`);
            return response.data; // { object: "list", hasMore: false, totalCount: 1, data: [...] }
        } catch (error: any) {
            this.logger.error(`Error fetching Asaas subscription ${id} payments: ${error.message}`);
            throw error;
        }
    }


    async createSinglePayment(data: {
        customer: string;
        billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX';
        value: number;
        dueDate: string;
        description?: string;
        externalReference?: string;
        creditCard?: any;
        creditCardHolderInfo?: any;
        remoteIp?: string;
    }) {
        const client = await this.getClient();
        this.logger.log(`Asaas Request [POST /payments]: ${JSON.stringify({ ...data, creditCard: data.creditCard ? '[REDACTED]' : undefined }, null, 2)}`);
        try {
            const response = await client.post('/payments', data);
            this.logger.log(`Asaas Response [POST /payments]: ${JSON.stringify(response.data, null, 2)}`);
            return response.data;
        } catch (error: any) {
            const errorMsg = error.response?.data?.errors?.[0]?.description || error.message;
            this.logger.error(`Error creating Asaas payment: ${errorMsg}`);
            throw new Error(`Erro Asaas (Payment): ${errorMsg}`);
        }
    }

    async getPixQrCode(paymentId: string) {
        const client = await this.getClient();
        this.logger.log(`Asaas Request [GET /payments/${paymentId}/pixQrCode]`);
        try {
            const response = await client.get(`/payments/${paymentId}/pixQrCode`);
            return response.data; // { payload: "...", encodedImage: "...", expirationDate: "..." }
        } catch (error: any) {
            const errorMsg = error.response?.data?.errors?.[0]?.description || error.message;
            this.logger.error(`Error getting Asaas PIX QR Code: ${errorMsg}`);
            throw new Error(`Erro Asaas (PIX QR): ${errorMsg}`);
        }
    }
}
