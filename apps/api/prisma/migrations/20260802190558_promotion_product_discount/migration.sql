-- AlterTable
ALTER TABLE "promotions" ADD COLUMN     "discountType" TEXT,
ADD COLUMN     "discountValue" INTEGER,
ADD COLUMN     "productId" TEXT;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
