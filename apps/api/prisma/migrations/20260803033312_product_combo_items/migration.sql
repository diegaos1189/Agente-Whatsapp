-- AlterTable
ALTER TABLE "products" ADD COLUMN     "comboItems" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "isCombo" BOOLEAN NOT NULL DEFAULT false;
