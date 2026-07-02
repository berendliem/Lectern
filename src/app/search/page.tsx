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
      <h1 className="text-2xl font-semibold text-zinc-900">Search</h1>
      {q.trim() ? <SearchResults results={results} /> : <p className="text-sm text-zinc-400">Search across transcripts, notes, and flashcards.</p>}
    </div>
  );
}
