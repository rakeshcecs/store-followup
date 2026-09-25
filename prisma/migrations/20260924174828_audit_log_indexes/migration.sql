-- CreateIndex
CREATE INDEX `audit_logs_entityId_idx` ON `audit_logs`(`entityId`);

-- CreateIndex
CREATE INDEX `audit_logs_createdAt_idx` ON `audit_logs`(`createdAt`);
