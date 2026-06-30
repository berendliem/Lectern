import { db } from "@/lib/db";

/**
 * Re-syncs the page_search FTS5 row for a page from its current Notes/Transcript/
 * Flashcard rows. Called explicitly after each pipeline stage writes, rather than
 * via SQL triggers, so the sync stays visible/debuggable in application code.
 */
export async function upsertSearchIndex(pageId: string) {
  const page = await db.page.findUnique({
    where: { id: pageId },
    include: { transcript: true, notes: true, flashcards: true },
  });
  if (!page) return;

  const flashcardsText = page.flashcards
    .map((f) => `${f.prompt} ${f.idealExplanation}`)
    .join(" ");

  await db.$executeRaw`DELETE FROM page_search WHERE pageId = ${pageId}`;
  await db.$executeRaw`
    INSERT INTO page_search (pageId, title, transcriptText, notesText, flashcardsText)
    VALUES (${pageId}, ${page.title}, ${page.transcript?.rawText ?? ""}, ${page.notes?.markdown ?? ""}, ${flashcardsText})
  `;
}

export async function removeFromSearchIndex(pageId: string) {
  await db.$executeRaw`DELETE FROM page_search WHERE pageId = ${pageId}`;
}

export type SearchResult = {
  pageId: string;
  title: string;
  snippet: string;
};

export async function searchPages(query: string, limit = 20): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // FTS5 query syntax treats bare terms as a phrase/operator query; wrap each
  // token in quotes and OR them so arbitrary user input can't break the MATCH syntax.
  const ftsQuery = trimmed
    .split(/\s+/)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(" OR ");

  const rows = await db.$queryRaw<SearchResult[]>`
    SELECT
      pageId,
      title,
      snippet(page_search, 2, '<mark>', '</mark>', '…', 12) AS snippet
    FROM page_search
    WHERE page_search MATCH ${ftsQuery}
    ORDER BY bm25(page_search)
    LIMIT ${limit}
  `;
  return rows;
}
