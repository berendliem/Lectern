import type { Metadata } from "next";
import { db } from "@/lib/db";
import { DictionaryManager } from "@/components/dictionary/DictionaryManager";
import type { KeyTerm } from "@/types";

export const metadata: Metadata = { title: "Dictionary — Lectern" };
export const dynamic = "force-dynamic";

// The dictionary feeds whisper's hotword list, where a long tail of terms
// stops helping; a lecture's most important terms are enough to offer.
const MAX_SUGGESTIONS = 12;

export default async function DictionaryPage({
  searchParams,
}: {
  searchParams: Promise<{ pageId?: string }>;
}) {
  const { pageId } = await searchParams;
  const page = pageId
    ? await db.page.findUnique({
        where: { id: pageId },
        select: { title: true, notes: { select: { keyTerms: true } } },
      })
    : null;

  const terms: KeyTerm[] = page?.notes?.keyTerms ? JSON.parse(page.notes.keyTerms) : [];

  return (
    <DictionaryManager
      contextLabel={page?.title}
      suggestions={terms
        .slice(0, MAX_SUGGESTIONS)
        // The hint column is capped at 200 characters; a longer definition
        // would be rejected on submit rather than saved truncated.
        .map((t) => ({ term: t.term, hint: t.definition.slice(0, 200) }))}
    />
  );
}
