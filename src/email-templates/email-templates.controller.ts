import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, UseGuards, Request } from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';
import { EmailTemplateCategory } from './email-templates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('email-templates')
@UseGuards(JwtAuthGuard)
export class EmailTemplatesController {
  constructor(private readonly emailTemplatesService: EmailTemplatesService) {}

  @Get()
  getTemplates(@Request() req) {
    return this.emailTemplatesService.getTemplates(req.user.userId);
  }

  @Get(':id')
  getTemplate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.emailTemplatesService.getTemplate(req.user.userId, id);
  }

  @Post()
  createTemplate(
    @Request() req,
    @Body() body: { name: string; subject?: string; html: string; category?: EmailTemplateCategory; description?: string },
  ) {
    return this.emailTemplatesService.createTemplate(req.user.userId, body);
  }

  @Patch(':id')
  updateTemplate(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string; subject?: string; html?: string; category?: EmailTemplateCategory; active?: boolean; description?: string },
  ) {
    return this.emailTemplatesService.updateTemplate(req.user.userId, id, body);
  }

  @Delete(':id')
  deleteTemplate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.emailTemplatesService.deleteTemplate(req.user.userId, id);
  }

  @Post('send')
  sendTemplate(
    @Request() req,
    @Body() body: { templateId: number; to: string | string[]; subject?: string; connectionId?: number; variables?: Record<string, string> },
  ) {
    return this.emailTemplatesService.sendTemplate(req.user.userId, body);
  }
}
