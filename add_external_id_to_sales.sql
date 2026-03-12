-- Migration para adicionar a coluna externalId na tabela sales
-- Execute este comando no seu banco de dados (MySQL)

ALTER TABLE `sales` 
ADD COLUMN `externalId` varchar(255) NULL 
AFTER `status`;

-- Opcional: Criar um índice para buscas mais rápidas durante o Sync
CREATE INDEX `idx_sales_externalId` ON `sales` (`externalId`);
