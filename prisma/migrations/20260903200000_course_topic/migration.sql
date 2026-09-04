-- CreateTable
CREATE TABLE "CourseTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "week" INTEGER,
    "order" INTEGER NOT NULL,
    "sourceMaterialId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseTopic_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CourseTopic_folderId_order_idx" ON "CourseTopic"("folderId", "order");
