-- Generated with `prisma migrate diff` (SQLite needs a table rebuild to add a
-- column with a non-constant default); hand-trimmed to drop the DropTable
-- statements the diff also proposed for `page_search` and its FTS5 shadow
-- tables, which the Prisma datamodel cannot see and which this migration does
-- not touch. The INSERT also carries `createdAt` into the new `updatedAt`
-- column explicitly: the generated diff would otherwise leave every existing
-- row to take the column default (`CURRENT_TIMESTAMP`, i.e. migration time),
-- which would make every transcript in the library look freshly modified and
-- falsely flag every page's notes as stale.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transcript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "cleanText" TEXT,
    "chapters" TEXT,
    "segments" TEXT NOT NULL,
    "language" TEXT,
    "modelUsed" TEXT,
    "contextText" TEXT,
    "contextSource" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transcript_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Transcript" ("chapters", "cleanText", "createdAt", "updatedAt", "id", "language", "modelUsed", "pageId", "rawText", "segments") SELECT "chapters", "cleanText", "createdAt", "createdAt", "id", "language", "modelUsed", "pageId", "rawText", "segments" FROM "Transcript";
DROP TABLE "Transcript";
ALTER TABLE "new_Transcript" RENAME TO "Transcript";
CREATE UNIQUE INDEX "Transcript_pageId_key" ON "Transcript"("pageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
