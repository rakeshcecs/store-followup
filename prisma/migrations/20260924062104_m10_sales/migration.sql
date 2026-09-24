/*
  Warnings:

  - You are about to alter the column `billNumber` on the `sales` table. The data in that column could be lost. The data in that column will be cast from `VarChar(50)` to `VarChar(30)`.

*/
-- AlterTable
ALTER TABLE `sales` MODIFY `billNumber` VARCHAR(30) NOT NULL;

-- AlterTable
ALTER TABLE `timeline_events` ADD COLUMN `entityId` VARCHAR(40) NULL;
