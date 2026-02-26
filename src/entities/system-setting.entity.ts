import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_settings')
export class SystemSetting {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true, length: 100 })
    key: string;

    @Column({ type: 'text', nullable: true })
    value: string;

    @Column({ length: 255, nullable: true })
    description: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
