import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { Contact } from '../entities/contact.entity';
import { ContactTag } from '../entities/contact-tag.entity';
import { ContactSegmentation } from '../entities/contact-segmentation.entity';
import { Tag } from '../entities/tag.entity';
import { Group } from '../entities/group.entity';
import { ContactPurchase } from '../entities/contact-purchase.entity';
import { Sale } from '../entities/sale.entity';
import { CampaignCoupon } from '../entities/campaign-coupon.entity';


@Module({
  imports: [TypeOrmModule.forFeature([Contact, ContactTag, ContactSegmentation, Tag, Group, ContactPurchase, Sale, CampaignCoupon])],

  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule { }
