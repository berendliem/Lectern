import Link from "next/link";
import { CheckCheck, Flame } from "lucide-react";

export function TodayRow({ dueCount, streak, totalCards }: { dueCount: number; streak: number; totalCards: number }) {
  let headline: string;
  if (totalCards === 0) headline = "Nothing due yet";
  else if (dueCount === 0) headline = "All caught up";
  else headline = `${dueCount} card${dueCount === 1 ? "" : "s"} due`;

  const detail = totalCards === 0 ? "record a lecture to get flashcards" : streak > 0 ? `${streak}-day streak` : null;

  return (
    <section
      aria-label="Today"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          {dueCount > 0 ? <Flame className="h-4 w-4" strokeWidth={2} /> : <CheckCheck className="h-4 w-4" strokeWidth={2} />}
        </span>
        <p className="text-[17px] font-semibold leading-6 text-ink">
          {headline}
          {detail && <span className="font-normal text-muted"> · {detail}</span>}
        </p>
      </div>
      {dueCount > 0 && (
        <Link
          href="/review"
          className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-brand hover:opacity-95 w-full sm:w-auto"
        >
          Review {dueCount}
        </Link>
      )}
    </section>
  );
}
