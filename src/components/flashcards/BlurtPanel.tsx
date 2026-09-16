"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type Feedback = {
  covered: string[];
  missed: string[];
  wrong: { claim: string; correction: string }[];
};

/**
 * Everything you remember, before you look. The result is not the score — it is
 * the cards: what you missed is written back onto this lecture as flashcards in
 * the same write that records the attempt.
 */
export function BlurtPanel({ pageId, className }: { pageId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [dump, setDump] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [cardsCreated, setCardsCreated] = useState(0);
  const router = useRouter();

  function close() {
    setOpen(false);
    setDump("");
    setError(null);
    setFeedback(null);
    setCardsCreated(0);
  }

  async function submit() {
    if (!dump.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/blurt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dump }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Marking your blurt failed");
        return;
      }
      setFeedback(body.feedback);
      setCardsCreated(body.cardsCreated ?? 0);
      router.refresh();
    } catch {
      setError("Marking your blurt failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <PenLine className="h-3.5 w-3.5" strokeWidth={2.2} /> Blurt it
      </button>

      <Modal open={open} onClose={close} title="What do you remember?">
        <div className="flex flex-col gap-3">
          {feedback ? (
            <>
              <p className="text-[13px] text-muted">
                {feedback.covered.length} point{feedback.covered.length === 1 ? "" : "s"} recalled,{" "}
                {feedback.missed.length} missed
                {feedback.wrong.length > 0 ? `, ${feedback.wrong.length} to correct` : ""}.{" "}
                {cardsCreated > 0
                  ? `${cardsCreated} card${cardsCreated === 1 ? "" : "s"} added to this lecture.`
                  : "Nothing left to turn into cards."}
              </p>

              {feedback.missed.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-2">
                    Missed
                  </p>
                  <ul className="flex flex-col gap-1 text-[13px] text-ink-soft">
                    {/* Keyed by position: the model can repeat a phrase, and
                        this list is never reordered. */}
                    {feedback.missed.map((point, i) => (
                      <li key={i}>· {point}</li>
                    ))}
                  </ul>
                </div>
              )}

              {feedback.wrong.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-2">
                    Worth correcting
                  </p>
                  <ul className="flex flex-col gap-1.5 text-[13px] text-ink-soft">
                    {feedback.wrong.map((item, i) => (
                      <li key={i}>
                        <span className="text-muted-2">You said:</span> {item.claim}
                        <br />
                        {item.correction}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end">
                <Button type="button" variant="secondary" onClick={close}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] text-muted">
                Write everything you can recall from this lecture, without looking at the notes.
                What you leave out becomes flashcards.
              </p>
              <textarea
                value={dump}
                onChange={(e) => setDump(e.target.value)}
                rows={10}
                aria-label="What you remember"
                className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted-2 focus:border-brand-border focus:outline-none"
                placeholder="It started with…"
              />
              {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="brand"
                  onClick={submit}
                  disabled={busy || dump.trim().length === 0}
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> Marking…
                    </>
                  ) : (
                    "Mark it"
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
