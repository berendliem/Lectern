import { db } from "@/lib/db";
import { FeynmanCoach } from "@/components/feynman/FeynmanCoach";
import type { KeyTerm } from "@/types";

export const metadata = { title: "Feynman coach — Lectern" };
export const dynamic = "force-dynamic";

// Cap on the notes handed to the coach as ground truth; feynmanEvaluateSchema
// rejects a longer reference outright, so trim here rather than 422 later.
const MAX_REFERENCE_CHARS = 20_000;
const MAX_SUGGESTIONS = 8;

/**
 * Pre-seeded from a lecture (`?pageId=`) or a course (`?folderId=`): the point
 * of launching the coach from a lecture is that you shouldn't have to retype
 * what you just studied.
 */
export default async function FeynmanPage({
  searchParams,
}: {
  searchParams: Promise<{ pageId?: string; folderId?: string }>;
}) {
  const { pageId, folderId } = await searchParams;

  if (pageId) {
    const page = await db.page.findUnique({
      where: { id: pageId },
      select: { title: true, notes: { select: { markdown: true, keyTerms: true } } },
    });
    if (page) {
      const terms: KeyTerm[] = page.notes?.keyTerms ? JSON.parse(page.notes.keyTerms) : [];
      return (
        <FeynmanCoach
          contextLabel={`Lecture: ${page.title}`}
          suggestions={terms.slice(0, MAX_SUGGESTIONS).map((t) => t.term)}
          initialReference={(page.notes?.markdown ?? "").slice(0, MAX_REFERENCE_CHARS)}
        />
      );
    }
  }

  if (folderId) {
    const folder = await db.folder.findUnique({
      where: { id: folderId },
      select: { name: true, topics: { orderBy: { order: "asc" }, select: { title: true } } },
    });
    if (folder) {
      return (
        <FeynmanCoach
          contextLabel={`Course: ${folder.name}`}
          suggestions={folder.topics.slice(0, MAX_SUGGESTIONS).map((t) => t.title)}
        />
      );
    }
  }

  return <FeynmanCoach />;
}
