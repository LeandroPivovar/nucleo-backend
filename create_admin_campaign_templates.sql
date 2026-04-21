-- Migration: Create admin_campaign_templates table
-- Run this on the server via:
--   mysql -u root -p nucleo_crm < create_admin_campaign_templates.sql

CREATE TABLE IF NOT EXISTS `admin_campaign_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'rascunho' COMMENT 'rascunho | publicada',
  `workflow` json DEFAULT NULL COMMENT 'WorkflowCanvas JSON { nodes: [], edges: [] }',
  `description` text DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
