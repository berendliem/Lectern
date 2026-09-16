"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Markdown } from "@/components/Markdown";
import { masteryOf, MASTERY_LABEL, MASTERY_CLASSES } from "@/lib/mastery";
import clsx from "@/lib/clsx";

export type FlashcardListItem = {
  id: string;
  prompt: string;
  idealExplanation: string;
  nextReviewAt: string | Date;
  repetitions: number;
  lastReviewedAt: string | Date | null;
};

export function isDue(card: FlashcardListItem, now = new Date()): boolean {
  return new Date(card.nextReviewAt) <= now;
}

export function FlashcardList({
  flashcards,
  revealAll,
  disabled = false,
}: {
  flashcards: FlashcardListItem[];
  /** Flips the default: every answer shown, and a click hides one instead. */
  revealAll: boolean;
  /** While the set is being regenerated: every card on screen is about to go. */
  disabled?: boolean;
}) {
  const router = useRouter();
  // Cards whose answer is the opposite of the default.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ prompt: "", idealExplanation: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = saving || disabled;

  // Flipping the default forgets every per-card toggle, so "Hide all" hides
  // everything and not everything except what was opened. Adjusted during
  // render rather than by remounting the list: a remount would also throw
  // away an edit in progress. Same for an edit whose card left the view.
  const [prevRevealAll, setPrevRevealAll] = useState(revealAll);
  if (revealAll !== prevRevealAll) {
    setPrevRevealAll(revealAll);
    setToggled(new Set());
  }
  if (editing && !flashcards.some((card) => card.id === editing)) setEditing(null);

  function toggle(id: string) {
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startEdit(card: FlashcardListItem) {
    setEditing(card.id);
    setDraft({ prompt: card.prompt, idealExplanation: card.idealExplanation });
    setError(null);
  }

  async function save(id: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/flashcards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not save that card.");
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(card: FlashcardListItem) {
    // The ledger keeps every attempt at this card (ReviewLog is SetNull); the
    // card's own interval and ease are what a delete throws away.
    const scheduled = card.repetitions > 0 ? " Its review schedule goes with it — the attempts you made stay on record." : "";
    if (!confirm(`Delete this card?${scheduled}\n\n“${card.prompt}”`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/flashcards/${card.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not delete that card.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSaving(false);
    }
  }

  if (flashcards.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-2">No cards in this view.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {flashcards.map((card) => {
          const due = isDue(card);
          const mastery = masteryOf(card.repetitions, card.lastReviewedAt);
          const shown = revealAll !== toggled.has(card.id);
          const isEditing = editing === card.id;
          return (
            <li key={card.id} className="rounded-xl border border-line bg-surface p-3">
              {isEditing ? (
                <div className="flex flex-col gap-2">
                  <Textarea
                    rows={2}
                    value={draft.prompt}
                    onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
                    aria-label="Prompt"
                    maxLength={2000}
                    disabled={busy}
                  />
                  <Textarea
                    rows={4}
                    value={draft.idealExplanation}
                    onChange={(e) => setDraft((d) => ({ ...d, idealExplanation: e.target.value }))}
                    aria-label="Reference explanation"
                    maxLength={8000}
                    disabled={busy}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => save(card.id)}
                      disabled={busy || !draft.prompt.trim() || !draft.idealExplanation.trim()}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-ink [&_p]:m-0">
                      <Markdown>{card.prompt}</Markdown>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={clsx(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          MASTERY_CLASSES[mastery]
                        )}
                      >
                        {MASTERY_LABEL[mastery]}
                      </span>
                      <Badge tone={due ? "amber" : "neutral"}>
                        {due ? "Due now" : `Due ${new Date(card.nextReviewAt).toLocaleDateString()}`}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => startEdit(card)}
                        disabled={busy}
                        aria-label="Edit card"
                        className="rounded-md p-1 text-muted-2 transition-colors hover:bg-surface-3 hover:text-ink-soft disabled:opacity-50"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(card)}
                        disabled={busy}
                        aria-label="Delete card"
                        className="rounded-md p-1 text-muted-2 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </span>
                  </div>
                  {shown ? (
                    <div className="mt-1 text-sm text-muted [&_p]:m-0">
                      <Markdown>{card.idealExplanation}</Markdown>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => toggle(card.id)}
                    aria-expanded={shown}
                    className="mt-2 text-xs font-medium text-muted-2 hover:text-brand-ink"
                  >
                    {shown ? "Hide answer" : "Show answer"}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
