import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { KanbanColumn } from './kanban-column.entity';
import { Contact } from './contact.entity';

@Entity('kanban_cards')
export class KanbanCard {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    userId: number;

    @ManyToOne(() => KanbanColumn, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'columnId' })
    column: KanbanColumn;

    @Column()
    columnId: number;

    @ManyToOne(() => Contact, { nullable: true, onDelete: 'SET NULL', eager: true })
    @JoinColumn({ name: 'contact_id' })
    contact: Contact | null;

    @Column({ name: 'contact_id', type: 'int', nullable: true })
    contactId: number | null;

    @Column({ length: 200 })
    title: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column({ type: 'int', default: 0 })
    order: number;

    @Column({ type: 'boolean', default: true })
    active: boolean;

    @Column({ type: 'json', nullable: true })
    metadata: Record<string, any> | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
