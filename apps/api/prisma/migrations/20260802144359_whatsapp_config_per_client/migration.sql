-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "whatsappApiVersion" TEXT NOT NULL DEFAULT 'v21.0',
ADD COLUMN     "whatsappAppSecret" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "whatsappPhoneNumberId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "whatsappProvider" TEXT NOT NULL DEFAULT 'mock',
ADD COLUMN     "whatsappToken" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "whatsappVerifyToken" TEXT NOT NULL DEFAULT '';
