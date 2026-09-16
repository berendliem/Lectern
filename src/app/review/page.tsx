import { CheckCheck } from "lucide-react";
import { db } from "@/lib/db";
import { ReviewSession } from "@/components/review/ReviewSession";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const dueCount = await db.flashcard.count({ where: { nextReviewAt: { lte: new Date() } } });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-3 rounded-2xl border border-brand-border bg-brand-soft p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white shadow-brand">
          <CheckCheck className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-ink">Review</h1>
          <p className="text-[13px] text-muted">
            {dueCount} card{dueCount === 1 ? "" : "s"} due across all courses. Spaced repetition keeps
            what you learned from fading.
          </p>
        </div>
      </div>
      <ReviewSession />
    </div>
  );
}
