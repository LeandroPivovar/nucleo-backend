import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InternalAnalytics } from '../entities/internal-analytics.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(InternalAnalytics)
    private readonly analyticsRepository: Repository<InternalAnalytics>,
  ) {}

  async trackEvent(userId: number | undefined, type: 'page_view' | 'action', name: string, metadata?: any) {
    const event = this.analyticsRepository.create({
      userId,
      type,
      name,
      metadata,
    });
    return this.analyticsRepository.save(event);
  }

  async getTopPageViews(limit = 10) {
    return this.analyticsRepository.createQueryBuilder('event')
      .select('event.name', 'page')
      .addSelect('COUNT(event.id)', 'count')
      .where('event.type = :type', { type: 'page_view' })
      .groupBy('event.name')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();
  }

  async getTopActions(limit = 10) {
    return this.analyticsRepository.createQueryBuilder('event')
      .select('event.name', 'action')
      .addSelect('COUNT(event.id)', 'count')
      .where('event.type = :type', { type: 'action' })
      .groupBy('event.name')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();
  }
}
