-- CreateTable
--
-- Hand-authored rather than `prisma migrate dev`: this repo's `page_search`
-- FTS5 virtual tables are invisible to the Prisma datamodel, so the diff
-- engine always proposes dropping them alongside any real change (see the
-- 20260908120000_recall_ledger migration for the same note). This table adds
-- cleanly with no rebuild, so there is nothing here but the CREATE.
CREATE TABLE "RetrievalLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "query" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL,
    "spread" INTEGER NOT NULL,
    "topScore" REAL NOT NULL,
    "sourceIds" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RetrievalLog_createdAt_idx" ON "RetrievalLog"("createdAt");
