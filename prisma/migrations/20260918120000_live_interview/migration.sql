-- Hand-written: `prisma migrate dev` would also propose dropping `page_search`
-- and its FTS5 shadow tables, which the Prisma datamodel cannot see.

-- AlterTable
ALTER TABLE "InterviewSession" ADD COLUMN "live" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InterviewTurn" ADD COLUMN "spoken" TEXT;
ALTER TABLE "InterviewTurn" ADD COLUMN "interruptedAt" INTEGER;
ALTER TABLE "InterviewTurn" ADD COLUMN "retryOf" TEXT;
