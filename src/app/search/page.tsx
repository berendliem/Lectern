import { searchPages } from "@/lib/fts";
import { SearchResults } from "@/components/search/SearchResults";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const results = q.trim() ? await searchPages(q) : [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Search</h1>
        <p className="mt-0.5 text-[13px] text-muted-2">Find anything across transcripts, notes, and flashcards.</p>
      </div>
      {q.trim() ? <SearchResults results={results} /> : <p className="text-sm text-muted-2">Search across transcripts, notes, and flashcards.</p>}
    </div>
  );
}
