-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "acceptedPaymentMethods" TEXT[] DEFAULT ARRAY['CASH', 'TRANSFER', 'CARD_ON_DELIVERY']::TEXT[];
