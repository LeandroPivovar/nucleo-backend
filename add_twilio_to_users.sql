-- Migration: Adicionar campos de credenciais Twilio por usuário
-- Execute este script no MySQL para adicionar os novos campos na tabela users

ALTER TABLE `users`
    ADD COLUMN IF NOT EXISTS `twilioAccountSid`  VARCHAR(50)  NULL DEFAULT NULL COMMENT 'Twilio Account SID da subconta do usuario',
    ADD COLUMN IF NOT EXISTS `twilioAuthToken`   VARCHAR(255) NULL DEFAULT NULL COMMENT 'Twilio Auth Token da subconta do usuario',
    ADD COLUMN IF NOT EXISTS `twilioWhatsappFrom` VARCHAR(30) NULL DEFAULT NULL COMMENT 'Numero WhatsApp Twilio no formato E.164 ex: +14155238886';

-- Verificar a alteração
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME IN ('twilioAccountSid', 'twilioAuthToken', 'twilioWhatsappFrom');
