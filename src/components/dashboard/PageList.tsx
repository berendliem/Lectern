import { PageCard, type PageCardData } from "@/components/dashboard/PageCard";

export function PageList({ pages }: { pages: PageCardData[] }) {
  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 py-16 text-center">
        <span className="text-3xl" aria-hidden="true">
          🎙️
        </span>
        <p className="font-medium text-zinc-600">No pages yet</p>
        <p className="max-w-xs text-sm text-zinc-400">
          Create a page, record or upload a lecture, and it becomes notes, flashcards, and a quiz.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((page) => (
        <PageCard key={page.id} page={page} />
      ))}
    </div>
  );
}
