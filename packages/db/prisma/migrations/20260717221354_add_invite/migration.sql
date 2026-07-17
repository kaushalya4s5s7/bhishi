-- CreateEnum
CREATE TYPE "InviteKind" AS ENUM ('LINK', 'EMAIL');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'CONSUMED', 'REVOKED');

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "circleAddress" TEXT NOT NULL,
    "kind" "InviteKind" NOT NULL,
    "email" TEXT,
    "invitedBy" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "consumedBy" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_circleAddress_idx" ON "Invite"("circleAddress");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_circleAddress_fkey" FOREIGN KEY ("circleAddress") REFERENCES "Circle"("address") ON DELETE CASCADE ON UPDATE CASCADE;
