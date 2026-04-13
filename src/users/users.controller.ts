import {
  Controller,
  Get,
  Patch,
  Put,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Get('me')
  async getProfile(@Request() req) {
    return this.usersService.findOne(req.user.userId);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  async updateProfile(@Request() req, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(req.user.userId, updateUserDto);
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Request() req, @Body() changePasswordDto: ChangePasswordDto) {
    await this.usersService.changePassword(req.user.userId, changePasswordDto);
    return { message: 'Senha alterada com sucesso' };
  }

  @Post('me/wipe-data')
  @HttpCode(HttpStatus.NO_CONTENT)
  async wipeData(@Request() req) {
    await this.usersService.wipeData(req.user.userId);
  }

  // ── Twilio WhatsApp ────────────────────────────────────────────

  /** GET /api/users/me/twilio — lê config atual (sem expor o authToken) */
  @Get('me/twilio')
  async getTwilioConfig(@Request() req) {
    return this.usersService.getTwilioConfig(req.user.userId);
  }

  /** PUT /api/users/me/twilio — salva credenciais da subconta manualmente */
  @Put('me/twilio')
  @HttpCode(HttpStatus.OK)
  async saveTwilioConfig(
    @Request() req,
    @Body() body: { accountSid: string; authToken: string; whatsappFrom: string },
  ) {
    return this.usersService.saveTwilioConfig(req.user.userId, body);
  }

  /** POST /api/users/me/twilio/create-subaccount — cria subconta via API Twilio */
  @Post('me/twilio/create-subaccount')
  @HttpCode(HttpStatus.CREATED)
  async createTwilioSubaccount(
    @Request() req,
    @Body() body: { friendlyName: string; whatsappFrom: string },
  ) {
    return this.usersService.createTwilioSubaccount(req.user.userId, body);
  }
}
