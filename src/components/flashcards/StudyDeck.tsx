"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import type { FlashcardListItem } from "@/components/flashcards/FlashcardList";
import { keyInputFromEvent, sessionKey } from "@/lib/review-keys";
import clsx from "@/lib/clsx";

/**
 * One card at a time, Quizlet-style: click or Space turns it, the arrow keys
 * step through the set. Nothing is graded or saved — this is for reading the
 * set through, and the review deck is where recall gets scored.
 */
export function StudyDeck({ flashcards }: { flashcards: FlashcardListItem[] }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // A new set (a filter click, a regenerate) starts face down at its first
  // card: the answer side of one card must not greet a different card.
  // Adjusted during render, the pattern FlashcardList uses for revealAll.
  const [prevCards, setPrevCards] = useState(flashcards);
  if (flashcards !== prevCards) {
    setPrevCards(flashcards);
    setIndex(0);
    setFlipped(false);
  }
  const count = flashcards.length;
  // A filter change can shrink the set below the current position.
  const at = Math.min(index, Math.max(count - 1, 0));
  const card = flashcards[at];

  function step(delta: number) {
    if (count === 0) return;
    setIndex((at + delta + count) % count);
    setFlipped(false);
  }

  // The page keeps visited tabs mounted but hidden, so the keys are only
  // taken while this deck is the one on screen.
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ step, count });
  useEffect(() => {
    latest.current = { step, count };
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!root.current || root.current.offsetParent === null) return;
      const action = sessionKey(keyInputFromEvent(e));
      if (!action || latest.current.count === 0) return;
      if (action.type === "space" || action.type === "enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (action.type === "prev") {
        latest.current.step(-1);
      } else if (action.type === "next") {
        latest.current.step(1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!card) {
    return (
      <p className="py-6 text-center text-sm text-muted-2">
        No cards in this view.
      </p>
    );
  }

  return (
    <div ref={root} className="flex flex-col items-center gap-3">
      {/* A div, not a button: card text is Markdown and may carry links. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setFlipped((f) => !f)}
        aria-pressed={flipped}
        aria-label={flipped ? "Show the prompt" : "Reveal the reference explanation"}
        className={clsx(
          "flex min-h-64 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border p-8 text-center shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-border",
          flipped ? "border-brand-border bg-brand-soft/50" : "border-line bg-surface hover:border-line-strong"
        )}
      >
        <span
          className={clsx(
            "mb-3 text-xs font-semibold uppercase tracking-wide",
            flipped ? "text-brand-ink" : "text-muted-2"
          )}
        >
          {flipped ? "Reference explanation" : "Prompt"}
        </span>
        <span className="text-lg text-ink [&_p]:m-0">
          <Markdown>{flipped ? card.idealExplanation : card.prompt}</Markdown>
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm text-muted">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous card"
          className="rounded-full border border-line p-1.5 transition-colors hover:border-brand-border hover:text-brand-ink"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
        </button>
        <span className="tabular-nums" aria-live="polite">
          {at + 1} / {count}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next card"
          className="rounded-full border border-line p-1.5 transition-colors hover:border-brand-border hover:text-brand-ink"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>
      <p className="text-[12px] text-muted-2">Space flips · ← → move</p>
    </div>
  );
}
