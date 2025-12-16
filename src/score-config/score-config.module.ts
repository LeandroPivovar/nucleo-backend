import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScoreConfigService } from './score-config.service';
import { ScoreConfigController } from './score-config.controller';
import { ScoreConfig } from '../entities/score-config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ScoreConfig])],
  controllers: [ScoreConfigController],
  providers: [ScoreConfigService],
  exports: [ScoreConfigService],
})
export class ScoreConfigModule {}

