"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Layers, List, Loader2, RefreshCw } from "lucide-react";
import { FlashcardList, isDue, type FlashcardListItem } from "@/components/flashcards/FlashcardList";
import { StudyDeck } from "@/components/flashcards/StudyDeck";
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

const MODES = [
  { value: "deck", label: "Cards", icon: Layers },
  { value: "list", label: "List", icon: List },
] as const;

function matches(card: FlashcardListItem, view: View, now: Date): boolean {
  if (view === "all") return true;
  if (view === "due") return isDue(card, now);
  return masteryOf(card.repetitions, card.lastReviewedAt) === view;
}

/**
 * The lecture's card set as a self-test: one card at a time by default, turned
 * with a click or Space and stepped with the arrow keys; or the full list with
 * answers hidden until asked for, where a card can be edited or deleted. A view
 * per mastery state, and a rewrite of the whole set.
 */
export function FlashcardsTab({ pageId, flashcards }: { pageId: string; flashcards: FlashcardListItem[] }) {
  const router = useRouter();
  const { run, task, clear } = useTasks();
  const [view, setView] = useState<View>("all");
  const [revealAll, setRevealAll] = useState(false);
  const [mode, setMode] = useState<"deck" | "list">("deck");

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
  // to open this tab. Memoised because the deck treats a new array as a new
  // set and starts over on it.
  const visible = useMemo(() => {
    const at = new Date();
    return flashcards
      .filter((card) => matches(card, view, at))
      .sort((a, b) => Number(isDue(b, at)) - Number(isDue(a, at)));
  }, [flashcards, view]);

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
        <div role="radiogroup" aria-label="Filter cards" className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
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
          <div role="radiogroup" aria-label="Layout" className="flex rounded-lg border border-line p-0.5">
            {MODES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={clsx(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium transition-colors",
                  mode === value ? "bg-brand-soft text-brand-ink" : "text-muted hover:text-ink-soft"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                {label}
              </button>
            ))}
          </div>
          {mode === "list" && (
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
          )}
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
      {mode === "deck" ? (
        <StudyDeck flashcards={visible} />
      ) : (
        <FlashcardList flashcards={visible} revealAll={revealAll} disabled={regenerating} />
      )}
    </div>
  );
}
