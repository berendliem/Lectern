"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { postTask } from "@/lib/tasks";
import type { WalkthroughStepView } from "@/lib/walkthrough";

type Feedback = {
  covered: string[];
  missed: string[];
  wrong: { claim: string; correction: string }[];
};

type Marked = { feedback: Feedback; quality: number; cardsCreated: number; stepIndex: number };

export function WalkthroughRunner({
  materialId,
  startIndex,
  steps: initialSteps,
}: {
  materialId: string;
  startIndex: number;
  steps: WalkthroughStepView[];
}) {
  const [steps, setSteps] = useState(initialSteps);
  const [index, setIndex] = useState(Math.min(startIndex, initialSteps.length - 1));
  // Which step's teach POST is in flight, or null. Keyed by id (not a plain
  // boolean) so step 4's render never reads step 3's still-in-flight call as
  // its own — see the `teaching` derivation below.
  const [teachingStepId, setTeachingStepId] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [answer, setAnswer] = useState("");
  const [marked, setMarked] = useState<Marked | null>(null);
  const [revealed, setRevealed] = useState(false);
  // Split so Retry can retry the thing that actually failed: teachError gets
  // a Retry button that re-runs teach(); markError is shown inline under the
  // Answer row with no Retry button, because the answer is still in the box
  // and pressing Answer again IS the retry.
  const [teachError, setTeachError] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);

  const step = steps[index];
  const recallPromptId = useId();

  // Whatever step is on screen right now. submit() and teach() capture the
  // step they started for and check this ref before touching screen state,
  // so a slow response for a step the student has since left via Next/Back
  // cannot paint over the step now showing. Synced from an effect rather
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
  const teachingRef = useRef<string | null>(null);

  const teach = useCallback(async () => {
    if (teachingRef.current === step.id) return;
    const forStepId = step.id;
    teachingRef.current = forStepId;
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
    } catch (e) {
      // teachError is screen state: a late failure for a step the student
      // left must not paint an error banner over whatever they moved to.
      if (shownStepId.current === forStepId) {
        setTeachError(e instanceof Error ? e.message : "Could not write this step.");
      }
    } finally {
      // Only release the mutex if it's still ours: if the student has since
      // moved on and that step's own teach() has already taken the ref, this
      // stale finally must not clear a lock it doesn't hold.
      if (teachingRef.current === forStepId) teachingRef.current = null;
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

  // Same reasoning as teachingRef above, and keyed the same way: a plain
  // boolean would block step 4's Answer click while step 3's request is
  // still in flight, even though step 4's own marking state shows the
  // button as enabled — a silent no-op is worse than a disabled button.
  const submittingStepId = useRef<string | null>(null);

  async function submit() {
    if (!answer.trim()) return;
    if (submittingStepId.current === step.id) return;
    const forStepId = step.id;
    submittingStepId.current = forStepId;
    setMarking(true);
    setMarkError(null);
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
      // The server graded this and wrote the ledger row regardless. Only the
      // screen paint is guarded: a late score for a step the student left
      // must not reveal a step they haven't answered.
      if (shownStepId.current !== forStepId) return;
      setMarked(data);
      setRevealed(true);
    } catch (e) {
      if (shownStepId.current !== forStepId) return;
      // The answer stays in the box and the Answer button re-enables: a
      // failed marking must not cost the typing, and pressing Answer again
      // is the retry, not a separate Retry button.
      setMarkError(e instanceof Error ? e.message : "Could not mark your answer.");
    } finally {
      if (submittingStepId.current === forStepId) submittingStepId.current = null;
      if (shownStepId.current === forStepId) setMarking(false);
    }
  }

  async function move(to: number) {
    const next = Math.max(0, Math.min(to, steps.length - 1));
    setIndex(next);
    setAnswer("");
    setMarked(null);
    setRevealed(false);
    setTeachError(null);
    setMarkError(null);
    // The step this screen is leaving no longer owns "Marking…": submit()'s
    // own guard above will skip touching this once its response lands, so
    // nothing would otherwise undo a stuck spinner for an abandoned request.
    setMarking(false);
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
            onChange={(e) => setAnswer(e.target.value)}
            disabled={marking || revealed}
            rows={5}
            placeholder="What do you remember about this step?"
            aria-labelledby={recallPromptId}
          />

          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={marking || revealed || !answer.trim()}>
              {marking ? "Marking…" : "Answer"}
            </Button>
            {!revealed && (
              <Button variant="ghost" onClick={() => setRevealed(true)} disabled={marking}>
                Show me instead
              </Button>
            )}
          </div>

          {markError && (
            <p role="alert" className="text-[13px] font-medium text-red-700">
              {markError}
            </p>
          )}

          {marked && (
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
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
                    {marked.feedback.missed.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}
              {marked.feedback.wrong.map((item) => (
                <p key={item.claim} className="text-muted">
                  <span className="text-ink">{item.claim}</span> — {item.correction}
                </p>
              ))}
            </div>
          )}

          {revealed && (
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3">
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-muted">
                {step.sourceText}
              </pre>
              <p className="text-sm leading-relaxed text-ink">{step.explanation}</p>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => move(index - 1)} disabled={index === 0}>
          Back
        </Button>
        <Button variant="ghost" onClick={() => move(index + 1)} disabled={index === steps.length - 1}>
          Next
        </Button>
      </div>
    </div>
  );
}
