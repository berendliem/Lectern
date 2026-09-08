-- Agent classroom: InterviewSession gains a mode (VIVA/PROTEGE/DEBATE), an
-- optional persona brief, and an optional courseTopicId so a debate or
-- recitation session can point at the syllabus topic it argues about.
-- InterviewTurn gains speaker so a turn can record who said it once a session
-- involves more than the examiner and the student. InterviewSource gains
-- COURSE_TOPIC; that is an enum value with no column of its own, so it needs
-- no DDL here.
--
-- SQLite cannot ALTER TABLE ADD FOREIGN KEY, so InterviewSession is a table
-- rebuild like ReviewLog before it. The INSERT ... SELECT carries every
-- existing session across unchanged; "mode" defaults to 'VIVA' for all of
-- them, which is today's only behavior, so no existing interview changes.
--
-- Prisma's own diff also proposed dropping page_search and its five shadow
-- tables. Those are the FTS5 virtual table from the init migration, invisible
-- to the datamodel and load-bearing for search — the DROPs are deliberately
-- not here (same call as the recall_ledger migration made).

-- AlterTable
ALTER TABLE "InterviewTurn" ADD COLUMN "speaker" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InterviewSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pageId" TEXT,
    "topicText" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'VIVA',
    "persona" TEXT,
    "courseTopicId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewSession_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InterviewSession_courseTopicId_fkey" FOREIGN KEY ("courseTopicId") REFERENCES "CourseTopic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InterviewSession" ("createdAt", "id", "pageId", "source", "status", "title", "topicText", "updatedAt") SELECT "createdAt", "id", "pageId", "source", "status", "title", "topicText", "updatedAt" FROM "InterviewSession";
DROP TABLE "InterviewSession";
ALTER TABLE "new_InterviewSession" RENAME TO "InterviewSession";
CREATE INDEX "InterviewSession_pageId_idx" ON "InterviewSession"("pageId");
CREATE INDEX "InterviewSession_status_idx" ON "InterviewSession"("status");
CREATE INDEX "InterviewSession_courseTopicId_idx" ON "InterviewSession"("courseTopicId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
