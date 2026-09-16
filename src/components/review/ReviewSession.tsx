"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCheck, PartyPopper } from "lucide-react";
import { FlashcardFlip } from "@/components/flashcards/FlashcardFlip";
import { GRADES, ReviewGradeButtons } from "@/components/review/ReviewGradeButtons";
import { cardSource } from "@/lib/cards";
import { Button } from "@/components/ui/Button";
import { MASTERY_SCORE, MAX_MASTERY_ATTEMPTS, scoreForQuality, shouldRequeue } from "@/lib/grading";
import { keyInputFromEvent, sessionKey } from "@/lib/review-keys";

type DueCard = {
  id: string;
  prompt: string;
  idealExplanation: string;
  page: { id: string; title: string; folder: { name: string } | null } | null;
  material: { id: string; title: string; folder: { name: string } | null } | null;
};

type Grade = {
  quality: number;
  score: number;
  verdict: string;
  missing: string[];
  grader: "llm" | "overlap";
};

export function ReviewSession({ folderId, pageId }: { folderId?: string; pageId?: string }) {
  // The queue, not the due list: a card recalled below the mastery bar goes to
  // the back of it, so the session ends when the deck is known rather than
  // when the list runs out.
  const [queue, setQueue] = useState<DueCard[] | null>(null);
  // Everything due, not just the batch loaded: the route caps a session, and
  // "Session complete" with forty cards still waiting is a lie by omission.
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [flipped, setFlipped] = useState(false);
  const [unmastered, setUnmastered] = useState(0);
  const [typed, setTyped] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped by every mark request, every edit to the answer, and every advance.
  // A reply whose number is stale was computed for text or a card that is no
  // longer on screen, and is dropped rather than applied to whatever is.
  const suggestSeq = useRef(0);

  const load = useCallback(
    (signal?: { ignore: boolean }) => {
      const params = new URLSearchParams();
      if (pageId) params.set("pageId", pageId);
      else if (folderId) params.set("folderId", folderId);
      const query = params.toString();
      return fetch(`/api/review/due${query ? `?${query}` : ""}`)
        .then((res) => res.json())
        .then((data) => {
          if (signal?.ignore) return;
          const cards: DueCard[] = data.cards ?? [];
          setQueue(cards);
          setTotal(typeof data.total === "number" ? data.total : cards.length);
        });
    },
    [folderId, pageId]
  );

  useEffect(() => {
    const signal = { ignore: false };
    load(signal);
    return () => {
      signal.ignore = true;
    };
  }, [load]);

  /** The next batch of what is still due. The cards just graded have moved on,
   *  so the same request now returns the ones this session never reached. */
  function loadMore() {
    suggestSeq.current++;
    setQueue(null);
    setIndex(0);
    setAttempts({});
    setUnmastered(0);
    setFlipped(false);
    setTyped("");
    setConfidence(null);
    setGrade(null);
    setGrading(false);
    setError(null);
    void load();
  }

  /**
   * Reveal, and — only if something was typed — mark that attempt. The reveal
   * never waits on the grader: the reference explanation appears immediately
   * and the mark catches up when it arrives.
   */
  async function handleFlip() {
    const next = !flipped;
    setFlipped(next);
    const card = queue?.[index];
    // Hiding and revealing again keeps the mark it already has; only an edit
    // to the answer (handleTyped) asks for a new one.
    if (!next || !card || typed.trim().length === 0 || grade || grading) return;

    const seq = ++suggestSeq.current;
    setGrading(true);
    setError(null);
    try {
      const res = await fetch(`/api/review/${card.id}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typed }),
      });
      if (seq !== suggestSeq.current) return;
      if (!res.ok) {
        setError("Couldn't mark what you wrote — grade it yourself below.");
        return;
      }
      const data = await res.json();
      if (typeof data.quality === "number" && typeof data.score === "number") {
        setGrade({
          quality: data.quality,
          score: data.score,
          verdict: typeof data.verdict === "string" ? data.verdict : "",
          missing: Array.isArray(data.missing) ? data.missing : [],
          grader: data.grader === "overlap" ? "overlap" : "llm",
        });
      }
    } catch {
      if (seq === suggestSeq.current) setError("Couldn't mark what you wrote — grade it yourself below.");
    } finally {
      if (seq === suggestSeq.current) setGrading(false);
    }
  }

  function handleTyped(value: string) {
    setTyped(value);
    // The mark in hand, or on its way, was for the old text.
    suggestSeq.current++;
    setGrade(null);
    setGrading(false);
  }

  async function handleGrade(quality: number, score: number) {
    const card = queue?.[index];
    // A second click while the first grade is in flight would post twice, read
    // the same attempt count twice, and skip the next card.
    if (!card || saving) return;
    setError(null);
    const attempt = (attempts[card.id] ?? 0) + 1;

    // Only the first go is evidence of recall: after that the reference has
    // been on screen, so a second go is practice and stays out of SM-2 and the
    // ledger. Recording it would schedule a card the student just read as
    // known, and resolve the misconception it had just demonstrated.
    if (attempt === 1) {
      setSaving(true);
      // Advancing on a failed write would drop the grade silently: the card
      // keeps the interval it had, and the student has no way to know their
      // answer went nowhere. So the deck only moves once the grade is recorded.
      try {
        const res = await fetch(`/api/review/${card.id}/grade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quality,
            typed: typed.trim() || undefined,
            confidence: confidence ?? undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "That grade didn't save. Try again.");
          return;
        }
      } catch {
        setError("That grade didn't save — check your connection and try again.");
        return;
      } finally {
        setSaving(false);
      }
    }

    suggestSeq.current++;
    setAttempts((a) => ({ ...a, [card.id]: attempt }));
    if (shouldRequeue(score, attempt)) {
      setQueue((q) => (q ? [...q, card] : q));
    } else if (score < MASTERY_SCORE) {
      setUnmastered((n) => n + 1);
    }

    setFlipped(false);
    setTyped("");
    setConfidence(null);
    setGrade(null);
    setGrading(false);
    setIndex((i) => i + 1);
  }

  // Space or Enter turns the card, 1–4 grade it, Enter takes the machine's
  // grade. Typing in the answer box is never a command, and a focused button
  // keeps Enter and Space for itself, so tabbing through the deck still works.
  const latest = useRef({ flipped, grade, saving, queue, index, handleFlip, handleGrade });
  latest.current = { flipped, grade, saving, queue, index, handleFlip, handleGrade };
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const state = latest.current;
      if (state.saving || !state.queue || state.index >= state.queue.length) return;
      const action = sessionKey(keyInputFromEvent(e));
      if (!action) return;
      if (!state.flipped) {
        if (action.type === "enter" || action.type === "space") {
          e.preventDefault();
          void state.handleFlip();
        }
        return;
      }
      if (action.type === "digit") {
        const pressed = GRADES[action.n - 1];
        if (pressed) void state.handleGrade(pressed.quality, scoreForQuality(pressed.quality));
      } else if (action.type === "enter" && state.grade) {
        e.preventDefault();
        void state.handleGrade(state.grade.quality, state.grade.score);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (queue === null) {
    return <p className="text-sm text-muted-2">Loading…</p>;
  }

  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-moss-soft text-moss-ink">
          <CheckCheck className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink-soft">All caught up</p>
          <p className="mt-1 text-[13px] text-muted-2">No cards are due right now — come back later.</p>
        </div>
      </div>
    );
  }

  if (index >= queue.length) {
    const reviewedCards = Object.keys(attempts).length;
    const moreDue = Math.max(0, total - reviewedCards);
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <PartyPopper className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink-soft">
            {/* Distinct cards, not grades: a card that came back twice is one
                card the student worked through, and counting attempts would
                inflate a five-card session into eight. */}
            Session complete — {reviewedCards} card{reviewedCards === 1 ? "" : "s"} reviewed.
          </p>
          {unmastered > 0 && (
            <p className="mt-1 text-[13px] text-muted-2">
              {unmastered} still under {MASTERY_SCORE}/100 after {MAX_MASTERY_ATTEMPTS} tries — they&rsquo;ll come
              back sooner.
            </p>
          )}
          {moreDue > 0 && (
            <Button size="sm" className="mt-3" onClick={loadMore}>
              Review {moreDue} more
            </Button>
          )}
          <Link
            href={pageId ? `/pages/${pageId}` : folderId ? `/folders/${folderId}` : "/"}
            className="mt-2 block text-[13px] font-medium text-brand-ink hover:underline"
          >
            {pageId ? "Back to the lecture" : "Back to your courses"}
          </Link>
        </div>
      </div>
    );
  }

  const card = queue[index];
  const progress = (index / queue.length) * 100;
  // Distinct cards, because a requeued card sits in the queue twice and would
  // otherwise count against what is still waiting on the server.
  const stillDue = total - new Set(queue.map((c) => c.id)).size;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5">
      <div className="w-full">
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-2">
          <span>
            Card {index + 1} of {queue.length}
            {(attempts[card.id] ?? 0) > 0 && " · second look"}
            {stillDue > 0 && ` · ${stillDue} more due after this`}
          </span>
          {(() => {
            const source = cardSource(card);
            if (!source) {
              return <span className="truncate font-medium text-muted-2">Unknown source</span>;
            }
            const label = source.course ? `${source.course} · ${source.title}` : source.title;
            if (source.kind === "lecture") {
              return (
                <Link href={`/pages/${source.id}`} className="truncate font-medium hover:text-brand-ink">
                  {label}
                </Link>
              );
            }
            return <span className="truncate font-medium">{label}</span>;
          })()}
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <FlashcardFlip
        prompt={card.prompt}
        idealExplanation={card.idealExplanation}
        flipped={flipped}
        onFlip={handleFlip}
        typed={typed}
        onTyped={handleTyped}
        confidence={confidence}
        onConfidence={setConfidence}
        disabled={saving}
      />
      <p className="hidden text-[11px] text-muted-2 sm:block" aria-hidden="true">
        {flipped ? (
          <>
            <kbd className="font-sans">1</kbd>–<kbd className="font-sans">4</kbd> to grade
            {grade && (
              <>
                {" · "}
                <kbd className="font-sans">Enter</kbd> to take the suggested grade
              </>
            )}
          </>
        ) : (
          <>
            <kbd className="font-sans">Space</kbd> to reveal · <kbd className="font-sans">⌘Enter</kbd> from the answer box
          </>
        )}
      </p>
      {flipped && grading && (
        <p role="status" className="text-[13px] text-muted-2">
          Marking what you wrote…
        </p>
      )}
      {flipped && grade && (
        <div role="status" className="w-full max-w-md rounded-xl border border-line-strong bg-surface-2 p-3 text-sm">
          <p className="font-medium text-ink">
            {grade.score}/100
            {grade.score < MASTERY_SCORE && ` · ${MASTERY_SCORE} to master`}
          </p>
          {/* An offline mark is a word count, not a reading: say so where it
              can't be skimmed past as ordinary feedback. */}
          {grade.verdict && (
            <p className={`mt-0.5 text-[13px] ${grade.grader === "overlap" ? "font-medium text-amber-700" : "text-ink-soft"}`}>
              {grade.verdict}
            </p>
          )}
          {grade.missing.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-[13px] text-muted">
              {grade.missing.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            className="mt-2"
            disabled={saving}
            onClick={() => handleGrade(grade.quality, grade.score)}
          >
            {shouldRequeue(grade.score, (attempts[card.id] ?? 0) + 1) ? "Next card — this one comes back" : "Next card"}
          </Button>
        </div>
      )}
      {flipped && (
        <div className="flex flex-col items-center gap-1.5">
          {grade && <p className="text-[11px] text-muted-2">Disagree? Grade it yourself:</p>}
          <ReviewGradeButtons
            onGrade={(quality) => handleGrade(quality, scoreForQuality(quality))}
            suggested={grade?.quality ?? null}
            disabled={saving}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
