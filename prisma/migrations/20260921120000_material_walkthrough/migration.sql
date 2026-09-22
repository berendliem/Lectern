-- CreateTable
--
-- Hand-authored rather than `prisma migrate dev`: this repo's `page_search`
-- FTS5 virtual tables are invisible to the Prisma datamodel, so the diff
-- engine always proposes dropping them alongside any real change (see
-- 20260911180000_calendar_events for the same note). Additive only — two new
-- tables and their indexes, no column dropped or rewritten.
--
-- RecallKind gains WALKTHROUGH in the datamodel only: Prisma stores enums as
-- TEXT on SQLite, so there is no type to alter here.
CREATE TABLE "Walkthrough" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Walkthrough_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Walkthrough_materialId_key" ON "Walkthrough"("materialId");

-- CreateTable
CREATE TABLE "WalkthroughStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walkthroughId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "explanation" TEXT,
    "recallPrompt" TEXT,
    CONSTRAINT "WalkthroughStep_walkthroughId_fkey" FOREIGN KEY ("walkthroughId") REFERENCES "Walkthrough" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WalkthroughStep_walkthroughId_ordinal_key" ON "WalkthroughStep"("walkthroughId", "ordinal");
