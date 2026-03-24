require('dotenv').config();
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ContactsService } from './src/contacts/contacts.service';

async function bootstrap() {
    console.log('starting app context...');
    const app = await NestFactory.createApplicationContext(AppModule);
    const contactsService = app.get(ContactsService);

    const userId = 7; // Replace if needed

    console.log('fetching all contacts...');
    const allContacts = await contactsService.findAll(userId);
    console.log('ALL CONTACTS HAS COUPON:');
    allContacts.forEach(c => {
        console.log(`- ${c.name}: hasActiveCoupon=${c.hasActiveCoupon}, hasClickedCampaign=${c.hasClickedCampaign}`);
    });

    console.log('\nfetching segments [active_coupon]...');
    const segmented = await contactsService.getContactsBySegments(userId, ['active_coupon']);
    console.log(`Returned ${segmented.length} contacts for active_coupon.`);
    segmented.forEach(c => console.log(`- ${c.name}`));

    await app.close();
}

bootstrap();
