-- CreateEnum
CREATE TYPE "CircleMode" AS ENUM ('LUCKY_DRAW', 'AUCTION');

-- CreateEnum
CREATE TYPE "CircleState" AS ENUM ('FILLING', 'ACTIVE', 'ABORTED_FILLING', 'COMMIT', 'REVEAL', 'DRAW', 'PAYOUT', 'COMPLETED', 'STALLED');

-- CreateTable
CREATE TABLE "Circle" (
    "address" TEXT NOT NULL,
    "factoryTx" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "contribution" DECIMAL(78,0) NOT NULL,
    "bond" DECIMAL(78,0) NOT NULL,
    "mode" "CircleMode" NOT NULL,
    "state" "CircleState" NOT NULL DEFAULT 'FILLING',
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lastIndexedBlock" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Circle_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "circleAddress" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "hasWon" BOOLEAN NOT NULL DEFAULT false,
    "slashed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL,
    "circleAddress" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "phase" "CircleState" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "commitDeadline" TIMESTAMP(3),
    "revealDeadline" TIMESTAMP(3),
    "vrfRequestId" TEXT,
    "drawRequestedAt" TIMESTAMP(3),
    "winner" TEXT,
    "winningDiscount" DECIMAL(78,0),

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" TEXT NOT NULL,
    "circleAddress" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp" TEXT,
    "tradition" TEXT,
    "circleSize" INTEGER,
    "trackingMethod" TEXT,
    "role" TEXT,
    "wantsTryNow" BOOLEAN NOT NULL DEFAULT false,
    "walletAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userAddress" TEXT,
    "email" TEXT,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "jobId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "id" TEXT NOT NULL,
    "lastIndexedBlock" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Circle_state_idx" ON "Circle"("state");

-- CreateIndex
CREATE INDEX "Circle_creator_idx" ON "Circle"("creator");

-- CreateIndex
CREATE INDEX "Member_address_idx" ON "Member"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Member_circleAddress_address_key" ON "Member"("circleAddress", "address");

-- CreateIndex
CREATE INDEX "Round_phase_idx" ON "Round"("phase");

-- CreateIndex
CREATE UNIQUE INDEX "Round_circleAddress_roundNumber_key" ON "Round"("circleAddress", "roundNumber");

-- CreateIndex
CREATE INDEX "ChainEvent_circleAddress_blockNumber_idx" ON "ChainEvent"("circleAddress", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ChainEvent_txHash_logIndex_key" ON "ChainEvent"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_email_key" ON "WaitlistEntry"("email");

-- CreateIndex
CREATE INDEX "NotificationLog_userAddress_idx" ON "NotificationLog"("userAddress");

-- CreateIndex
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_circleAddress_fkey" FOREIGN KEY ("circleAddress") REFERENCES "Circle"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_circleAddress_fkey" FOREIGN KEY ("circleAddress") REFERENCES "Circle"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChainEvent" ADD CONSTRAINT "ChainEvent_circleAddress_fkey" FOREIGN KEY ("circleAddress") REFERENCES "Circle"("address") ON DELETE CASCADE ON UPDATE CASCADE;
