import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class FixCustomEmailSendersAndTracking1795000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const emailConnections = await queryRunner.getTable('email_connections');
    if (emailConnections && !emailConnections.findColumnByName('senderName')) {
      await queryRunner.addColumn('email_connections', new TableColumn({
        name: 'senderName',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }));
    }
    if (emailConnections && !emailConnections.findColumnByName('verifiedAt')) {
      await queryRunner.addColumn('email_connections', new TableColumn({
        name: 'verifiedAt',
        type: 'datetime',
        isNullable: true,
      }));
    }

    // Aproveita o e-mail da conta somente quando ele pertence ao domínio solicitado.
    await queryRunner.query(`
      UPDATE email_connections ec
      INNER JOIN users u ON u.id = ec.userId
      SET ec.email = LOWER(TRIM(u.email))
      WHERE ec.type = 'domain'
        AND (ec.email IS NULL OR TRIM(ec.email) = '')
        AND LOWER(SUBSTRING_INDEX(TRIM(u.email), '@', -1)) = LOWER(TRIM(ec.domain))
    `);

    // Os status antigos eram aprovações manuais, sem teste do remetente na Zenvia.
    await queryRunner.query(`
      UPDATE email_connections
      SET status = 'pending',
          verifiedAt = NULL,
          adminNote = 'Revalidação técnica necessária: confirme o endereço remetente e valide-o na Zenvia.'
      WHERE type = 'domain' AND status = 'verified'
    `);

    const messageEvents = await queryRunner.getTable('campaign_message_events');
    if (messageEvents) {
      const messageSid = messageEvents.findColumnByName('messageSid');
      if (messageSid && messageSid.length !== '191') {
        await queryRunner.query(
          'ALTER TABLE `campaign_message_events` MODIFY `messageSid` varchar(191) NOT NULL',
        );
      }

      const timestampColumns = ['deliveredAt', 'readAt', 'clickedAt', 'failedAt'];
      for (const name of timestampColumns) {
        if (!messageEvents.findColumnByName(name)) {
          await queryRunner.addColumn('campaign_message_events', new TableColumn({
            name,
            type: 'datetime',
            isNullable: true,
          }));
        }
      }
      if (!messageEvents.findColumnByName('failureReason')) {
        await queryRunner.addColumn('campaign_message_events', new TableColumn({
          name: 'failureReason',
          type: 'text',
          isNullable: true,
        }));
      }
    }

    // Corrige apenas a inconsistência matematicamente impossível deixada pelo
    // fluxo antigo. O histórico sem messageId não permite reconstrução exata.
    await queryRunner.query(`
      UPDATE campaigns
      SET deliveredCount = sentCount
      WHERE channel = 'email' AND deliveredCount > sentCount
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const messageEvents = await queryRunner.getTable('campaign_message_events');
    if (messageEvents) {
      for (const name of ['failureReason', 'failedAt', 'clickedAt', 'readAt', 'deliveredAt']) {
        if (messageEvents.findColumnByName(name)) {
          await queryRunner.dropColumn('campaign_message_events', name);
        }
      }
      const messageSid = messageEvents.findColumnByName('messageSid');
      if (messageSid && messageSid.length !== '80') {
        await queryRunner.query(
          'ALTER TABLE `campaign_message_events` MODIFY `messageSid` varchar(80) NOT NULL',
        );
      }
    }

    const emailConnections = await queryRunner.getTable('email_connections');
    if (emailConnections?.findColumnByName('verifiedAt')) {
      await queryRunner.dropColumn('email_connections', 'verifiedAt');
    }
    if (emailConnections?.findColumnByName('senderName')) {
      await queryRunner.dropColumn('email_connections', 'senderName');
    }
  }
}
