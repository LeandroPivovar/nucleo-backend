import { PartialType } from '@nestjs/mapped-types';
import { CreateContactPurchaseDto } from './create-contact-purchase.dto';

export class UpdateContactPurchaseDto extends PartialType(CreateContactPurchaseDto) {}

