-- Backfill: LINK invites previously stored `email` as NULL. Postgres unique
-- indexes treat NULL as distinct from every other NULL, so a nullable email
-- would never dedupe LINK rows. Normalize to the '' sentinel before adding
-- the unique constraint that relies on it.
UPDATE "Invite" SET "email" = '' WHERE "kind" = 'LINK' AND "email" IS NULL;

-- AlterTable
ALTER TABLE "Invite" ALTER COLUMN "email" SET NOT NULL,
                     ALTER COLUMN "email" SET DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "Invite_circleAddress_kind_email_key" ON "Invite"("circleAddress", "kind", "email");
