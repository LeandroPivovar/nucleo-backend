import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('plans')
export class Plan {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 100 })
    name: string;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    price: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    priceYearly: number;

    @Column({ length: 20, default: 'monthly' })
    interval: string; // 'monthly', 'yearly'

    @Column({ type: 'json', nullable: true })
    features: string[]; // List of feature strings

    @Column({ type: 'json', nullable: true })
    limits: {
        contacts: number;
        emails: number;
        whatsapp: boolean;
        whatsappLimit: number; // Added: Monthly WhatsApp limit if enabled
        sms: number;
        internalUsers?: number;
        advancedCampaigns?: number;
    };

    @Column({ default: true })
    active: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
