-- Migration: Add role column to users table and set initial admin
-- Run this on the server via:
--   mysql -u root -p nucleo_crm < add_role_to_users.sql

-- 1. Add role column
ALTER TABLE `users` ADD COLUMN `role` VARCHAR(20) NOT NULL DEFAULT 'user' AFTER `password`;

-- 2. Set the initial administrator
UPDATE `users` SET `role` = 'admin' WHERE `email` = 'leandrocaetanopivovarr@gmail.com';
