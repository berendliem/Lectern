import Link from "next/link";
import type { SearchResult } from "@/lib/fts";

const MARK_PATTERN = /<mark>(.*?)<\/mark>/g;

function renderSnippet(snippet: string) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  MARK_PATTERN.lastIndex = 0;
  while ((match = MARK_PATTERN.exec(snippet)) !== null) {
    if (match.index > lastIndex) parts.push(snippet.slice(lastIndex, match.index));
    parts.push(
      <mark key={key++} className="rounded bg-amber-200 px-0.5 text-ink">
        {match[1]}
      </mark>
    );
    lastIndex = MARK_PATTERN.lastIndex;
  }
  if (lastIndex < snippet.length) parts.push(snippet.slice(lastIndex));
  return parts;
}

export function SearchResults({ results }: { results: SearchResult[] }) {
  if (results.length === 0) {
    return <p className="text-sm text-muted-2">No results.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {results.map((r) => (
        <li key={r.pageId}>
          <Link
            href={`/pages/${r.pageId}`}
            className="block rounded-xl border border-line bg-surface p-4 transition-shadow hover:shadow-md"
          >
            <p className="font-medium text-ink">{r.title}</p>
            <p className="mt-1 text-sm text-ink-soft">{renderSnippet(r.snippet)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
