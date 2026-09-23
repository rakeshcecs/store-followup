-- SOW 5.8: branch name is Text(80) and GST number is Text(15).
-- AlterTable
ALTER TABLE `branches` MODIFY `name` VARCHAR(80) NOT NULL,
    MODIFY `gstNumber` VARCHAR(15) NULL;
