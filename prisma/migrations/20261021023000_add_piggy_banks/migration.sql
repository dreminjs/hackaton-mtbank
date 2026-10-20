-- AlterEnum
ALTER TYPE "Category" ADD VALUE IF NOT EXISTS 'SAVINGS';

-- CreateEnum
CREATE TYPE "PiggyBankStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'BROKEN');

-- CreateTable
CREATE TABLE "PiggyBank" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetAmount" DECIMAL(10,2) NOT NULL,
    "currentAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    "targetDate" TIMESTAMP(3),
    "status" "PiggyBankStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PiggyBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiggyBankContribution" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "comment" TEXT,
    "piggyBankId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PiggyBankContribution_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PiggyBank" ADD CONSTRAINT "PiggyBank_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiggyBankContribution" ADD CONSTRAINT "PiggyBankContribution_piggyBankId_fkey" FOREIGN KEY ("piggyBankId") REFERENCES "PiggyBank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiggyBankContribution" ADD CONSTRAINT "PiggyBankContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiggyBankContribution" ADD CONSTRAINT "PiggyBankContribution_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
