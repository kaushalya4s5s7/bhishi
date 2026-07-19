-- CreateTable
CREATE TABLE "RoundBid" (
    "id" TEXT NOT NULL,
    "circleAddress" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "member" TEXT NOT NULL,
    "bid" DECIMAL(78,0) NOT NULL,
    "won" BOOLEAN NOT NULL DEFAULT false,
    "revealedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoundBid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoundBid_circleAddress_roundNumber_idx" ON "RoundBid"("circleAddress", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RoundBid_circleAddress_roundNumber_member_key" ON "RoundBid"("circleAddress", "roundNumber", "member");

-- AddForeignKey
ALTER TABLE "RoundBid" ADD CONSTRAINT "RoundBid_circleAddress_fkey" FOREIGN KEY ("circleAddress") REFERENCES "Circle"("address") ON DELETE CASCADE ON UPDATE CASCADE;
