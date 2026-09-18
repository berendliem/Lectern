-- Hand-authored rather than `prisma migrate dev`: this repo's `page_search`
-- FTS5 virtual tables are invisible to the Prisma datamodel, so the diff
-- engine always proposes dropping them alongside any real change (see the
-- 20260908120000_recall_ledger migration for the same note). Additive
-- nullable columns and one index; no existing row changes.
ALTER TABLE "Folder" ADD COLUMN "onqCourseId" INTEGER;
ALTER TABLE "Material" ADD COLUMN "onqTopicId" INTEGER;
ALTER TABLE "Material" ADD COLUMN "onqLastModified" TEXT;

-- SQLite treats NULLs as distinct in a unique index, so hand-uploaded
-- materials (onqTopicId NULL) are unaffected.
CREATE UNIQUE INDEX "Material_folderId_onqTopicId_key" ON "Material"("folderId", "onqTopicId");
