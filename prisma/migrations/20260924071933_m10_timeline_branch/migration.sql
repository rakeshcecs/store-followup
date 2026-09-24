-- AlterTable
ALTER TABLE `timeline_events` ADD COLUMN `branchId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `timeline_events` ADD CONSTRAINT `timeline_events_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the rows written before this column existed.
-- Sale rows name their sale.
UPDATE `timeline_events` t
JOIN `sales` s ON s.`id` = t.`entityId`
SET t.`branchId` = s.`branchId`
WHERE t.`branchId` IS NULL AND t.`type` LIKE 'sale.%';

-- Visit, follow-up and not-interested rows are written in the same transaction as the
-- visit, by the same person: take the branch of that visit (created within a minute).
UPDATE `timeline_events` t
JOIN `visits` v
  ON v.`customerId` = t.`customerId`
 AND v.`salespersonId` = t.`staffId`
 AND ABS(TIMESTAMPDIFF(SECOND, v.`createdAt`, t.`createdAt`)) <= 60
SET t.`branchId` = v.`branchId`
WHERE t.`branchId` IS NULL
  AND t.`type` IN ('visit.recorded', 'followup.set', 'enquiry.lost');
