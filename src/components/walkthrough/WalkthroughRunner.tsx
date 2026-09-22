"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { postTask } from "@/lib/tasks";
import type { walkthroughRecallResponseSchema } from "@/lib/validation";
import type { WalkthroughStepView } from "@/lib/walkthrough";

type Marked = {
  feedback: z.infer<typeof walkthroughRecallResponseSchema>;
  quality: number;
  cardsCreated: number;
};

/** Everything about answering one step. */
type StepState = {
  answer: string;
  marking: boolean;
  marked: Marked | null;
  revealed: boolean;
  markError: string | null;
  /** The latest score on this step, from the ledger or from this visit. */
  score: number | null;
};

const BLANK: StepState = {
  answer: "",
  marking: false,
  marked: null,
  revealed: false,
  markError: null,
  score: null,
};

export function WalkthroughRunner({
  materialId,
  folderId,
  startIndex,
  lastScores,
  steps: initialSteps,
}: {
  materialId: string;
  folderId: string;
  startIndex: number;
  /** Each answered step's latest score from the ledger, by step id. */
  lastScores: Record<string, number>;
  steps: WalkthroughStepView[];
}) {
  const [steps, setSteps] = useState(initialSteps);
  const [index, setIndex] = useState(Math.min(startIndex, initialSteps.length - 1));
  // Which step's teach POST is in flight, or null. Keyed by id (not a plain
  // boolean) so step 4's render never reads step 3's still-in-flight call as
  // its own — see the `teaching` derivation below.
  const [teachingStepId, setTeachingStepId] = useState<string | null>(null);
  // Answering state is kept per step, not for the screen: the student can move
  // on while an answer is marked, and the mark lands on the step it was for
  // rather than on whichever one is showing. A step answered on an earlier
  // visit opens revealed, with its last score, instead of asking again.
  const [byStep, setByStep] = useState<Record<string, StepState>>(() =>
    Object.fromEntries(
      Object.entries(lastScores).map(([id, score]) => [id, { ...BLANK, revealed: true, score }])
    )
  );
  // teachError gets a Retry button that re-runs teach(); a step's markError is
  // shown inline under its Answer row with no Retry button, because the answer
  // is still in the box and pressing Answer again IS the retry.
  const [teachError, setTeachError] = useState<string | null>(null);
  // A mark that lands after the student has moved on would otherwise be
  // silent, and a failed one would look saved.
  const [elsewhere, setElsewhere] = useState<string | null>(null);

  const step = steps[index];
  const { answer, marking, marked, revealed, markError, score } = byStep[step.id] ?? BLANK;
  const patch = (id: string, change: Partial<StepState>) =>
    setByStep((prev) => ({ ...prev, [id]: { ...(prev[id] ?? BLANK), ...change } }));
  const recallPromptId = useId();

  // Whatever step is on screen right now. teach() captures the step it
  // started for and checks this ref before touching screen state, so a slow
  // response for a step the student has since left via Next/Back cannot
  // paint over the step now showing. Synced from an effect rather
  // than written directly during render (react-hooks/refs forbids mutating a
  // ref in the render body); a passive effect still flushes long before any
  // network response it needs to beat, since the user can't click ahead of
  // their own browser's paint.
  const shownStepId = useRef(step.id);
  useEffect(() => {
    shownStepId.current = step.id;
  }, [step.id]);

  // A synchronous mutex, kept separate from the teachingStepId state above.
  // StrictMode's double-run mount effect calls this effect's body twice back
  // to back, before either call's setTeachingStepId has committed a
  // re-render — a state-only check would still read stale (null) on the
  // second synchronous call and let both POSTs through. This ref is mutated
  // synchronously at call time, so the second call sees it immediately; the
  // state exists only so the render below can show which step is teaching.
  //
  // A Set, not a single id: teach() deliberately lets the student navigate
  // freely while it runs, so more than one step can be mid-fetch at once —
  // Next to an untaught step while an earlier one is still in flight, then
  // Back before it resolves, must see that earlier step's own lock still
  // held, not a single slot some other step has since taken over.
  const teachingRef = useRef<Set<string>>(new Set());

  const teach = useCallback(async () => {
    if (teachingRef.current.has(step.id)) return;
    const forStepId = step.id;
    teachingRef.current.add(forStepId);
    setTeachingStepId(forStepId);
    setTeachError(null);
    try {
      const data = (await postTask(
        `/api/materials/${materialId}/walkthrough/steps/${forStepId}/teach`,
        "Could not write this step.",
        undefined,
        "Network error talking to the local server."
      )) as { step: WalkthroughStepView };
      // Cached by id unconditionally, even if the student has navigated away:
      // this is what makes a step they already left come back already taught.
      setSteps((prev) => prev.map((s) => (s.id === data.step.id ? data.step : s)));
      // A success always takes the banner down, even one left by this same
      // step's own earlier failed attempt.
      if (shownStepId.current === forStepId) setTeachError(null);
    } catch (e) {
      // teachError is screen state: a late failure for a step the student
      // left must not paint an error banner over whatever they moved to.
      if (shownStepId.current === forStepId) {
        setTeachError(e instanceof Error ? e.message : "Could not write this step.");
      }
    } finally {
      teachingRef.current.delete(forStepId);
      if (shownStepId.current === forStepId) setTeachingStepId(null);
    }
  }, [materialId, step.id]);

  // A step is written once, on arrival. A failure leaves it unwritten and the
  // Retry button visible; it never advances on its own. `teachingRef` (not
  // teachingStepId state) is what actually blocks a duplicate fetch for this
  // step, so neither is in this condition or its deps: gating on the state
  // would make step 4's effect wait for step 3's still-in-flight teach to
  // settle before firing its own, well after step 4 is on screen.
  useEffect(() => {
    // react-hooks/set-state-in-effect flags this as a synchronous setState in
    // an effect because `teach` sets state before its first await. That's the
    // documented data-fetching-on-mount pattern (React docs' own example does
    // the same via a locally-scoped async function); `teach` is only pulled
    // out of the effect via useCallback so the Retry button can reuse it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!step.recallPrompt && !teachError) void teach();
  }, [step.recallPrompt, teachError, teach]);

  // Guards a same-frame double click on Answer, which `disabled` alone can't
  // catch because React state updates aren't synchronous. A Set for the same
  // reason as teachingRef: two steps can be mid-mark at once.
  const submitting = useRef<Set<string>>(new Set());

  async function submit() {
    const forStepId = step.id;
    const forLabel = step.label;
    if (!answer.trim() || submitting.current.has(forStepId)) return;
    submitting.current.add(forStepId);
    patch(forStepId, { marking: true, markError: null });
    try {
      const data = (await postTask(
        `/api/materials/${materialId}/walkthrough/steps/${forStepId}/recall`,
        "Could not mark your answer.",
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer }),
        },
        "Network error talking to the local server."
      )) as Marked;
      patch(forStepId, { marked: data, revealed: true, score: data.quality });
      if (shownStepId.current !== forStepId) setElsewhere(`${forLabel}: scored ${data.quality}/5.`);
    } catch (e) {
      // The answer stays in the box and the Answer button re-enables: a
      // failed marking must not cost the typing, and pressing Answer again
      // is the retry, not a separate Retry button.
      patch(forStepId, { markError: e instanceof Error ? e.message : "Could not mark your answer." });
      if (shownStepId.current !== forStepId) {
        setElsewhere(`${forLabel}: your answer couldn't be marked. Go back to it to try again.`);
      }
    } finally {
      submitting.current.delete(forStepId);
      patch(forStepId, { marking: false });
    }
  }

  async function move(to: number) {
    const next = Math.max(0, Math.min(to, steps.length - 1));
    setIndex(next);
    setTeachError(null);
    setElsewhere(null);
    // Position is persisted so a refresh lands here again. A failure is silent
    // on purpose: the student has already moved, and a message about
    // bookkeeping would interrupt studying to report nothing they can act on.
    try {
      await fetch(`/api/materials/${materialId}/walkthrough`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIndex: next }),
      });
    } catch {
      // ignored, deliberately
    }
  }

  const teaching = teachingStepId === step.id;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] font-medium uppercase tracking-wide text-muted-2">
        {step.label} · {index + 1} of {steps.length}
      </p>

      <p role="status" className={elsewhere ? "text-[13px] text-muted" : "sr-only"}>
        {elsewhere}
      </p>

      {teachError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
        >
          <p className="text-[13px] font-medium text-red-700">{teachError}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTeachError(null);
              void teach();
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {!step.recallPrompt ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-2">
          {teaching && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
          {teaching ? "Writing this step…" : "This step hasn't been written yet."}
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <p id={recallPromptId} className="text-sm font-medium text-ink">
              {step.recallPrompt}
            </p>
            <p className="mt-1 text-[12.5px] text-muted-2">
              Answer from memory first. The material is revealed after you do.
            </p>
          </div>

          <Textarea
            value={answer}
            onChange={(e) => patch(step.id, { answer: e.target.value })}
            disabled={marking || revealed}
            rows={5}
            maxLength={4000}
            placeholder="Answer from memory…"
            aria-labelledby={recallPromptId}
          />

          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={marking || revealed || !answer.trim()}>
              {marking ? "Marking…" : "Answer"}
            </Button>
            {revealed ? (
              <Button
                variant="ghost"
                onClick={() => patch(step.id, { answer: "", marked: null, revealed: false, markError: null })}
              >
                {score === null ? "Answer it" : "Answer again"}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => patch(step.id, { revealed: true })} disabled={marking}>
                Show me instead
              </Button>
            )}
          </div>

          {markError && (
            <p role="alert" className="text-[13px] font-medium text-red-700">
              {markError}
            </p>
          )}

          {/* Mounted before any result so screen readers announce the score when it lands. */}
          <div
            role="status"
            className={
              marked
                ? "flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]"
                : "sr-only"
            }
          >
            {marked && (
              <>
                <p className="font-medium text-ink">
                  Scored {marked.quality}/5
                  {marked.cardsCreated > 0
                    ? ` · ${marked.cardsCreated} card${marked.cardsCreated === 1 ? "" : "s"} made from what you missed`
                    : ""}
                </p>
                {marked.feedback.missed.length > 0 && (
                  <div>
                    <p className="font-medium text-ink">You didn&apos;t mention</p>
                    <ul className="list-disc pl-5 text-muted">
                      {marked.feedback.missed.map((point, i) => (
                        <li key={i}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {marked.feedback.wrong.map((item, i) => (
                  <p key={i} className="text-muted">
                    <span className="text-ink">{item.claim}</span> — {item.correction}
                  </p>
                ))}
              </>
            )}
          </div>

          {revealed && !marked && score !== null && (
            <p className="text-[13px] text-muted">Last time you scored {score}/5 on this step.</p>
          )}

          {revealed && (
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3">
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-muted">
                {step.sourceText}
              </pre>
              <p className="text-sm leading-relaxed text-ink">{step.explanation}</p>
            </div>
          )}

          {revealed && index === steps.length - 1 && (
            <p className="text-sm text-muted">
              End of the walkthrough.{" "}
              <Link href={`/folders/${folderId}`} className="font-medium text-brand-ink hover:underline">
                Back to the course
              </Link>
            </p>
          )}
        </>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => move(index - 1)} disabled={index === 0}>
          Back
        </Button>
        <Button
          variant="ghost"
          onClick={() => move(index + 1)}
          disabled={index === steps.length - 1}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
