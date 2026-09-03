-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "pageId" TEXT,
    "materialId" TEXT,
    "ord" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "vector" BLOB NOT NULL,
    "hash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Chunk_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chunk_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Chunk_pageId_idx" ON "Chunk"("pageId");

-- CreateIndex
CREATE INDEX "Chunk_materialId_idx" ON "Chunk"("materialId");
