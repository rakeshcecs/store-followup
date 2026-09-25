-- Prisma writes new tables as utf8mb4_unicode_ci; every other table is utf8mb4_0900_ai_ci
-- (20260923120000_utf8mb4_0900_collation), and search must behave the same everywhere.
ALTER TABLE `whatsapp_unknown_messages` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
