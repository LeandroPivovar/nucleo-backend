import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScoreConfig } from '../entities/score-config.entity';
import { UpdateScoreConfigDto } from './dto/update-score-config.dto';

@Injectable()
export class ScoreConfigService {
  constructor(
    @InjectRepository(ScoreConfig)
    private scoreConfigRepository: Repository<ScoreConfig>,
  ) { }

  async getOrCreate(userId: number): Promise<ScoreConfig> {
    let config = await this.scoreConfigRepository.findOne({
      where: { userId },
    });

    if (!config) {
      // Criar configuração padrão
      config = this.scoreConfigRepository.create({
        userId,
        linkClicks: 3,
        purchases: 10,
        ltvDivisor: 10,
      });
      config = await this.scoreConfigRepository.save(config);
    }

    return config;
  }

  async update(
    userId: number,
    updateDto: UpdateScoreConfigDto,
  ): Promise<ScoreConfig> {
    let config = await this.getOrCreate(userId);

    if (updateDto.linkClicks !== undefined) {
      config.linkClicks = updateDto.linkClicks;
    }
    if (updateDto.purchases !== undefined) {
      config.purchases = updateDto.purchases;
    }
    if (updateDto.ltvDivisor !== undefined) {
      config.ltvDivisor = updateDto.ltvDivisor;
    }

    return this.scoreConfigRepository.save(config);
  }

  async resetToDefaults(userId: number): Promise<ScoreConfig> {
    let config = await this.getOrCreate(userId);

    config.linkClicks = 3;
    config.purchases = 10;
    config.ltvDivisor = 10;

    return this.scoreConfigRepository.save(config);
  }
}

