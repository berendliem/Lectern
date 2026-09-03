-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Flashcard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT,
    "materialId" TEXT,
    "prompt" TEXT NOT NULL,
    "idealExplanation" TEXT NOT NULL,
    "sourceTerm" TEXT,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Flashcard_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Flashcard_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Flashcard" ("createdAt", "easeFactor", "id", "idealExplanation", "intervalDays", "lastReviewedAt", "nextReviewAt", "pageId", "prompt", "repetitions", "sourceTerm", "updatedAt") SELECT "createdAt", "easeFactor", "id", "idealExplanation", "intervalDays", "lastReviewedAt", "nextReviewAt", "pageId", "prompt", "repetitions", "sourceTerm", "updatedAt" FROM "Flashcard";
DROP TABLE "Flashcard";
ALTER TABLE "new_Flashcard" RENAME TO "Flashcard";
CREATE INDEX "Flashcard_pageId_idx" ON "Flashcard"("pageId");
CREATE INDEX "Flashcard_materialId_idx" ON "Flashcard"("materialId");
CREATE INDEX "Flashcard_nextReviewAt_idx" ON "Flashcard"("nextReviewAt");
CREATE TABLE "new_QuizQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT,
    "materialId" TEXT,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "options" TEXT,
    "explanation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizQuestion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuizQuestion_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuizQuestion" ("correctAnswer", "createdAt", "explanation", "id", "options", "pageId", "prompt", "type") SELECT "correctAnswer", "createdAt", "explanation", "id", "options", "pageId", "prompt", "type" FROM "QuizQuestion";
DROP TABLE "QuizQuestion";
ALTER TABLE "new_QuizQuestion" RENAME TO "QuizQuestion";
CREATE INDEX "QuizQuestion_pageId_idx" ON "QuizQuestion"("pageId");
CREATE INDEX "QuizQuestion_materialId_idx" ON "QuizQuestion"("materialId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
