import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('bot_whatsapp_sessions')
export class BotWhatsappSession {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  sessionId: string;

  @Column({ type: 'longtext' })
  sessionData: string;
}
