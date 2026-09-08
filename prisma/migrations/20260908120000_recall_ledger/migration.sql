-- ReviewLog becomes the recall ledger: one row per attempt at recalling
-- something, whatever asked for it.
--
-- SQLite cannot ALTER TABLE ADD FOREIGN KEY, so this is a table rebuild. The
-- INSERT ... SELECT is what carries the existing rows across: they are streak
-- evidence, and losing them would silently reset every streak in the app.
-- Backfilled rows take kind = 'FLASHCARD' and quality = 0; quality 0 is a
-- failing grade, so every read that scores quality filters on
-- RECALL_LEDGER_SINCE (src/lib/recall.ts) to keep them out.
--
-- Prisma's own diff also proposed dropping page_search and its five shadow
-- tables. Those are the FTS5 virtual table from the init migration, invisible
-- to the datamodel and load-bearing for search — the DROPs are deliberately
-- not here.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReviewLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flashcardId" TEXT,
    "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'FLASHCARD',
    "quality" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER,
    "topicId" TEXT,
    "pageId" TEXT,
    "materialId" TEXT,
    "misconception" TEXT,
    "resolvedAt" DATETIME,
    "detail" TEXT,
    CONSTRAINT "ReviewLog_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReviewLog_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "CourseTopic" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReviewLog_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReviewLog_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReviewLog" ("flashcardId", "id", "reviewedAt") SELECT "flashcardId", "id", "reviewedAt" FROM "ReviewLog";
DROP TABLE "ReviewLog";
ALTER TABLE "new_ReviewLog" RENAME TO "ReviewLog";
CREATE INDEX "ReviewLog_reviewedAt_idx" ON "ReviewLog"("reviewedAt");
CREATE INDEX "ReviewLog_topicId_reviewedAt_idx" ON "ReviewLog"("topicId", "reviewedAt");
CREATE INDEX "ReviewLog_pageId_reviewedAt_idx" ON "ReviewLog"("pageId", "reviewedAt");
CREATE INDEX "ReviewLog_materialId_reviewedAt_idx" ON "ReviewLog"("materialId", "reviewedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
