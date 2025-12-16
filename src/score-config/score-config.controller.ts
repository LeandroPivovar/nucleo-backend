import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ScoreConfigService } from './score-config.service';
import { UpdateScoreConfigDto } from './dto/update-score-config.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('score-config')
export class ScoreConfigController {
  constructor(private readonly scoreConfigService: ScoreConfigService) {}

  @Get()
  async getConfig(@Request() req) {
    return this.scoreConfigService.getOrCreate(req.user.userId);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  async updateConfig(@Request() req, @Body() updateDto: UpdateScoreConfigDto) {
    return this.scoreConfigService.update(req.user.userId, updateDto);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async resetToDefaults(@Request() req) {
    return this.scoreConfigService.resetToDefaults(req.user.userId);
  }
}

