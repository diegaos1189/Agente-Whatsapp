/*
  Warnings:

  - You are about to drop the column `transferAccountInfo` on the `business_settings` table. All the data in the column will be lost.
  - You are about to drop the column `transferBankName` on the `business_settings` table. All the data in the column will be lost.
  - You are about to drop the column `transferQrImage` on the `business_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "business_settings" DROP COLUMN "transferAccountInfo",
DROP COLUMN "transferBankName",
DROP COLUMN "transferQrImage",
ADD COLUMN     "transferAccounts" JSONB NOT NULL DEFAULT '[]';
