-- AlterTable
--
-- Hand-authored for the same reason as 20260921120000_material_walkthrough:
-- the diff engine would also drop the page_search FTS5 tables. Additive only,
-- one nullable column; existing walkthroughs fill it on their next resume.
ALTER TABLE "Walkthrough" ADD COLUMN "sourceHash" TEXT;
