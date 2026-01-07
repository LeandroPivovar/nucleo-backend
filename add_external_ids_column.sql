-- Migration manual para adicionar coluna externalIds à tabela products
-- Execute este SQL diretamente no banco de dados se a migration não funcionar

ALTER TABLE `products` 
ADD COLUMN `externalIds` JSON NULL 
AFTER `active`;

-- Verificar se a coluna foi criada
-- DESCRIBE products;
-- ou
-- SHOW COLUMNS FROM products LIKE 'externalIds';

