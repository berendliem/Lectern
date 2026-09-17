-- Hand-written: `prisma migrate dev` would also propose dropping `page_search`
-- and its FTS5 shadow tables, which the Prisma datamodel cannot see.

-- AlterTable
ALTER TABLE "Notes" ADD COLUMN "previousMarkdown" TEXT;
