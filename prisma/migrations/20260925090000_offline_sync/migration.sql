-- AlterTable
ALTER TABLE `customers` ADD COLUMN `clientId` CHAR(36) NULL,
    ADD COLUMN `enteredOffline` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `follow_ups` ADD COLUMN `enteredOffline` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `sales` ADD COLUMN `enteredOffline` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX `customers_clientId_key` ON `customers`(`clientId`);
