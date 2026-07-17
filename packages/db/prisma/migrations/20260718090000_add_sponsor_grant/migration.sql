-- CreateTable
CREATE TABLE "SponsorGrant" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "amountWei" DECIMAL(78,0) NOT NULL,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SponsorGrant_walletAddress_createdAt_idx" ON "SponsorGrant"("walletAddress", "createdAt");
