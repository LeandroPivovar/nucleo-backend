import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ContactPurchasesService } from './contact-purchases.service';
import { CreateContactPurchaseDto } from './dto/create-contact-purchase.dto';
import { UpdateContactPurchaseDto } from './dto/update-contact-purchase.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('contact-purchases')
export class ContactPurchasesController {
  constructor(
    private readonly contactPurchasesService: ContactPurchasesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req, @Body() createDto: CreateContactPurchaseDto) {
    return this.contactPurchasesService.create(req.user.userId, createDto);
  }

  @Get()
  findAll(@Request() req, @Query('contactId') contactId?: string) {
    if (contactId) {
      return this.contactPurchasesService.findAllByContact(
        req.user.userId,
        +contactId,
      );
    }
    return this.contactPurchasesService.findAllByUser(req.user.userId);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.contactPurchasesService.findOne(req.user.userId, +id);
  }

  @Patch(':id')
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateDto: UpdateContactPurchaseDto,
  ) {
    return this.contactPurchasesService.update(req.user.userId, +id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req, @Param('id') id: string) {
    return this.contactPurchasesService.remove(req.user.userId, +id);
  }

  @Get('contact/:contactId/ltv')
  getContactLTV(@Request() req, @Param('contactId') contactId: string) {
    return this.contactPurchasesService.getContactLTV(+contactId);
  }
}

