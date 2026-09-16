"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { FlashcardList, isDue, type FlashcardListItem } from "@/components/flashcards/FlashcardList";
import { Button } from "@/components/ui/Button";
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";
import { masteryOf, MASTERY_LABEL, type Mastery } from "@/lib/mastery";
import clsx from "@/lib/clsx";

type View = "all" | "due" | Mastery;

const VIEWS: View[] = ["all", "due", "new", "learning", "mastered"];

const VIEW_LABEL: Record<View, string> = {
  all: "All",
  due: "Due",
  ...MASTERY_LABEL,
};

function matches(card: FlashcardListItem, view: View, now: Date): boolean {
  if (view === "all") return true;
  if (view === "due") return isDue(card, now);
  return masteryOf(card.repetitions, card.lastReviewedAt) === view;
}

/**
 * The lecture's card set as a self-test: answers hidden until asked for, a view
 * per mastery state, and the two edits the list used to lack — fixing one card
 * the model got wrong, and rewriting the whole set.
 */
export function FlashcardsTab({ pageId, flashcards }: { pageId: string; flashcards: FlashcardListItem[] }) {
  const router = useRouter();
  const { run, task, clear } = useTasks();
  const [view, setView] = useState<View>("all");
  const [revealAll, setRevealAll] = useState(false);

  // Same key the pipeline banner uses, so the two never run the same
  // generation twice.
  const taskKey = `page:${pageId}:generate-flashcards`;
  const regenerating = task(taskKey)?.status === "running";
  const regenerateError = task(taskKey)?.error;

  const now = new Date();
  const counts = Object.fromEntries(
    VIEWS.map((v) => [v, flashcards.filter((card) => matches(card, v, now)).length])
  ) as Record<View, number>;

  // Due first within the view: the cards asking for attention are the reason
  // to open this tab.
  const visible = flashcards
    .filter((card) => matches(card, view, now))
    .sort((a, b) => Number(isDue(b, now)) - Number(isDue(a, now)));

  async function regenerate() {
    // The route deletes every card before writing new ones. Intervals, ease and
    // the review schedule behind them go too; the ledger of attempts stays.
    const count = flashcards.length;
    if (
      !confirm(
        `Regenerate flashcards for this lecture? Its ${count} existing card${count === 1 ? "" : "s"} will be replaced, and the review progress on them (intervals and ease) is lost.`
      )
    ) {
      return;
    }
    clear([taskKey]);
    await run({ key: taskKey, label: "Writing flashcards…", href: `/pages/${pageId}` }, async () => {
      await postTask(
        `/api/pages/${pageId}/generate-flashcards`,
        "Flashcard generation failed. You can retry from here.",
        undefined,
        "Lost connection to the local server mid-step. You can retry from here."
      );
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={clsx(
                "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                view === v
                  ? "border-brand-border bg-brand-soft text-brand-ink"
                  : "border-line text-muted hover:border-brand-border"
              )}
            >
              {VIEW_LABEL[v]} <span className="tabular-nums opacity-70">{counts[v]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRevealAll((r) => !r)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            {revealAll ? (
              <EyeOff className="h-3.5 w-3.5" strokeWidth={2.2} />
            ) : (
              <Eye className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
            {revealAll ? "Hide all" : "Show all"}
          </button>
          <Button variant="secondary" size="sm" onClick={regenerate} disabled={regenerating}>
            {regenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
            )}
            {regenerating ? "Regenerating…" : "Regenerate"}
          </Button>
        </div>
      </div>
      {regenerateError && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          {regenerateError}
        </p>
      )}
      {/* Keyed on the default so flipping it forgets every per-card toggle:
          "Hide all" hides everything, not everything except what was opened. */}
      <FlashcardList key={String(revealAll)} flashcards={visible} revealAll={revealAll} />
    </div>
  );
}
