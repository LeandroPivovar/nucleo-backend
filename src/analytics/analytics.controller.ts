import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('track')
  @UseGuards(JwtAuthGuard)
  async track(@Body() body: { type: 'page_view' | 'action', name: string, metadata?: any }, @Req() req: any) {
    const userId = req.user?.id || null;
    return this.analyticsService.trackEvent(userId, body.type, body.name, body.metadata);
  }
}
