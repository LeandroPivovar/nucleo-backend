import { DataSource } from 'typeorm';
import { Contact } from './src/entities/contact.entity';
import { ContactPurchase } from './src/entities/contact-purchase.entity';
import { User } from './src/entities/user.entity';
import { ContactTag } from './src/entities/contact-tag.entity';
import { ContactSegmentation } from './src/entities/contact-segmentation.entity';
import { Group } from './src/entities/group.entity';
import { Tag } from './src/entities/tag.entity';
import { Product } from './src/entities/product.entity';
import 'dotenv/config';

async function testStats() {
    const dataSource = new DataSource({
        type: 'mysql',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        username: process.env.DB_USERNAME || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_DATABASE || 'nucleo_crm',
        entities: [Contact, ContactPurchase, User, ContactTag, ContactSegmentation, Group, Tag, Product],
    });

    await dataSource.initialize();
    console.log("DB connected");

    const userId = 1; // Assuming user 1
    const repo = dataSource.getRepository(Contact);
    const cpRepo = dataSource.getRepository(ContactPurchase);

    try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const inactiveContacts = await repo
            .createQueryBuilder('contact')
            .innerJoin('contact_purchases', 'purchase', 'purchase.contactId = contact.id')
            .where('contact.userId = :userId', { userId })
            .groupBy('contact.id')
            .having('MAX(purchase.purchaseDate) < :ninetyDaysAgo', { ninetyDaysAgo })
            .getRawMany();

        console.log("inactiveContacts SUCCESS", inactiveContacts.length);
    } catch (e) {
        console.error("inactiveContacts FAIL", e.message);
    }

    try {
        const buyers = await cpRepo
            .createQueryBuilder('purchase')
            .innerJoin('contacts', 'contact', 'contact.id = purchase.contactId')
            .where('contact.userId = :userId', { userId })
            .select('DISTINCT contact.id')
            .getRawMany();

        console.log("buyers SUCCESS", buyers.length);
    } catch (e) {
        console.error("buyers FAIL", e.message);
    }

    try {
        const highTicket = await cpRepo
            .createQueryBuilder('purchase')
            .innerJoin('contacts', 'contact', 'contact.id = purchase.contactId')
            .where('contact.userId = :userId', { userId })
            .groupBy('contact.id')
            .having('AVG(purchase.value) > :value', { value: 500 })
            .getRawMany();
        console.log("highTicket SUCCESS", highTicket.length);
    } catch (e) {
        console.error("highTicket FAIL", e.message);
    }

    await dataSource.destroy();
}

testStats();
