-- CreateTable
--
-- Hand-authored rather than `prisma migrate dev`: this repo's `page_search`
-- FTS5 virtual tables are invisible to the Prisma datamodel, so the diff
-- engine always proposes dropping them alongside any real change (see the
-- 20260908120000_recall_ledger migration for the same note). Additive table,
-- nothing here but the CREATE and its indexes.
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start" DATETIME NOT NULL,
    "end" DATETIME,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "folderId" TEXT,
    "folderPinned" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarEvent_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_externalKey_key" ON "CalendarEvent"("externalKey");

-- CreateIndex
CREATE INDEX "CalendarEvent_start_idx" ON "CalendarEvent"("start");

-- CreateIndex
CREATE INDEX "CalendarEvent_folderId_start_idx" ON "CalendarEvent"("folderId", "start");
