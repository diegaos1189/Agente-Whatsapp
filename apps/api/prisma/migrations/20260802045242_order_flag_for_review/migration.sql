-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "flagNote" TEXT,
ADD COLUMN     "flaggedForReview" BOOLEAN NOT NULL DEFAULT false;
