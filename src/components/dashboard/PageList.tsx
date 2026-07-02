import { Mic } from "lucide-react";
import { PageCard, type PageCardData } from "@/components/dashboard/PageCard";

export function PageList({ pages }: { pages: PageCardData[] }) {
  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Mic className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-zinc-700">No lectures yet</p>
          <p className="mx-auto mt-1 max-w-xs text-[13px] leading-5 text-zinc-400">
            Create a page and record or upload a lecture — it becomes notes, flashcards, and a quiz.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((page) => (
        <PageCard key={page.id} page={page} />
      ))}
    </div>
  );
}
