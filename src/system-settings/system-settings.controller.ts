import { Controller, Get, Patch, Body, Post, UseGuards } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmailService } from '../email/email.service';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard)
export class SystemSettingsController {
    constructor(
        private readonly systemSettingsService: SystemSettingsService,
        private readonly emailService: EmailService
    ) { }

    @Get()
    async findAll() {
        return this.systemSettingsService.findAll();
    }

    @Patch('bulk')
    async updateBulk(@Body() settings: { key: string; value: string; description?: string }[]) {
        await this.systemSettingsService.upsertMany(settings);
        return { success: true, message: 'Settings updated successfully' };
    }

    @Post('test-email')
    async testEmail(@Body('email') email: string) {
        if (!email) {
            return { success: false, message: 'O e-mail de destino é obrigatório' };
        }

        try {
            await this.emailService.sendEmail({
                to: email,
                subject: 'Teste de Conexão SMTP - Núcleo CRM',
                html: `
                    <h2>Teste de Conexão SMTP Concluído</h2>
                    <p>Olá,</p>
                    <p>Se você está recebendo esta mensagem, significa que as credenciais SMTP configuradas no painel do Núcleo CRM estão corretas e o sistema está conseguindo disparar e-mails com sucesso.</p>
                    <hr>
                    <p><small>Enviado automaticamente pelo sistema de configurações do Núcleo CRM.</small></p>
                `,
            });
            return { success: true, message: 'E-mail de teste enviado com sucesso!' };
        } catch (error: any) {
            return { success: false, message: `Erro: ${error.message}` };
        }
    }
}
