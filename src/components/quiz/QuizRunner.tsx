"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ShortAnswerQuestion } from "@/components/quiz/ShortAnswerQuestion";
import { MultipleChoiceQuestion } from "@/components/quiz/MultipleChoiceQuestion";
import { ClozeQuestion } from "@/components/quiz/ClozeQuestion";
import { MathQuestion } from "@/components/quiz/MathQuestion";
import { QuizResultsSummary } from "@/components/quiz/QuizResultsSummary";
import { Button } from "@/components/ui/Button";
import { MASTERY_SCORE, MAX_MASTERY_ATTEMPTS, shouldRequeue } from "@/lib/grading";
import { keyInputFromEvent, sessionKey } from "@/lib/review-keys";

export type QuizQuestionForRunner = {
  id: string;
  type: "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "CLOZE" | "MATH";
  prompt: string;
  options: string[] | null;
};

type Feedback = {
  isCorrect: boolean;
  score: number;
  verdict: string | null;
  missing: string[];
  /** "overlap" when the marking model was unreachable and word overlap stood in. */
  grader: "llm" | "overlap" | null;
  correctAnswer: string;
  explanation: string | null;
};

type ResultRecord = Feedback & { id: string; prompt: string; userAnswer: string; attempt: number };

export function QuizRunner({ questions }: { questions: QuizQuestionForRunner[] }) {
  // The queue, not the question list: a question answered below the mastery
  // bar is pushed onto the end of it, so the session lasts until the material
  // is known rather than until the list runs out.
  const [queue, setQueue] = useState<QuizQuestionForRunner[]>(questions);
  // A drill adds questions and refreshes the page mid-session. They join the end
  // of this run rather than restarting it: a restart would put answered questions
  // back in front of the student, and a re-answered question reads as a fresh
  // first attempt to the review ledger.
  const [received, setReceived] = useState(questions);
  if (questions !== received) {
    setReceived(questions);
    setQueue((q) => [...q, ...questions.filter((added) => !q.some((queued) => queued.id === added.id))]);
  }
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [requeued, setRequeued] = useState(false);
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(answer: string) {
    // Enter from the keyboard and a click can land in the same tick; the
    // second would mark the same attempt twice.
    if (submitting) return;
    const question = queue[index];
    // Sent along so the route records only the first go in the ledger; after
    // a miss the correct answer has been on screen.
    const attempt = (attempts[question.id] ?? 0) + 1;
    setSubmitting(true);
    setError(null);
    let data: Feedback;
    try {
      const res = await fetch(`/api/quiz/${question.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, attempt }),
      });
      if (!res.ok) {
        // Silence here would look like a dead Submit button, and the student
        // would retype an answer that was never marked.
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "That answer didn't get marked. Try submitting it again.");
        return;
      }
      const body = await res.json();
      // The route validates the model's JSON before it ever gets here, so this
      // is belt-and-braces against a future shape change — not a live hole.
      data = { ...body, missing: Array.isArray(body.missing) ? body.missing : [] };
    } catch {
      setError("Could not reach Lectern. Check it is still running, then submit again.");
      return;
    } finally {
      setSubmitting(false);
    }

    const comingBack = shouldRequeue(data.score, attempt);
    setAttempts((a) => ({ ...a, [question.id]: attempt }));
    if (comingBack) setQueue((q) => [...q, question]);
    setRequeued(comingBack);
    setFeedback(data);
    setResults((r) => [...r, { ...data, id: question.id, prompt: question.prompt, userAnswer: answer, attempt }]);
  }

  function handleNext() {
    setFeedback(null);
    setRequeued(false);
    setIndex((i) => i + 1);
  }

  /** Back to the first question, with nothing remembered: the attempt history
   *  on the server is what the drill button reads, and it is untouched. */
  function restart() {
    setQueue(questions);
    setIndex(0);
    setAttempts({});
    setFeedback(null);
    setRequeued(false);
    setResults([]);
    setError(null);
  }

  // Enter moves on once the mark is up. The question components own the keys
  // before that, and a focused button keeps Enter for itself.
  const latest = useRef({ feedback, handleNext });
  useEffect(() => {
    latest.current = { feedback, handleNext };
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const state = latest.current;
      if (!state.feedback) return;
      if (sessionKey(keyInputFromEvent(e))?.type === "enter") {
        e.preventDefault();
        state.handleNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (questions.length === 0) return null;

  if (index >= queue.length) {
    return <QuizResultsSummary results={results} onRestart={restart} />;
  }

  const question = queue[index];
  const priorAttempts = attempts[question.id] ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1.5 text-sm text-muted-2">
          Question {index + 1} of {queue.length}
          {priorAttempts > 0 && " · second look"}
        </p>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${(index / queue.length) * 100}%` }}
          />
        </div>
      </div>

      {/*
        Keyed on the question and the attempt, so coming back to a question
        remounts the input rather than reusing it. Without this, two questions
        of the same type in a row share a component instance — and its useState
        — so the answer typed for one appears already filled in for the next.
      */}
      <Fragment key={`${question.id}-${priorAttempts}`}>
        {question.type === "MATH" ? (
          <MathQuestion prompt={question.prompt} onSubmit={handleSubmit} disabled={submitting || !!feedback} />
        ) : question.type === "SHORT_ANSWER" ? (
          <ShortAnswerQuestion prompt={question.prompt} onSubmit={handleSubmit} disabled={submitting || !!feedback} />
        ) : question.type === "CLOZE" ? (
          <ClozeQuestion prompt={question.prompt} onSubmit={handleSubmit} disabled={submitting || !!feedback} />
        ) : (
          <MultipleChoiceQuestion
            prompt={question.prompt}
            options={question.options ?? []}
            onSubmit={handleSubmit}
            disabled={submitting || !!feedback}
          />
        )}
      </Fragment>

      {/* The free-text grader is a model call, so submitting is no longer
          instant. Without this the page looks frozen for a few seconds. */}
      {submitting && <p className="text-[13px] text-muted-2">Marking your answer…</p>}
      {error && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          {error}
        </p>
      )}

      {feedback && (
        <div
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            feedback.isCorrect ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <p className="font-medium">
            {feedback.isCorrect ? "Correct" : "Not quite"} · {feedback.score}/100
            {!feedback.isCorrect && ` (${MASTERY_SCORE} to pass)`}
          </p>
          {/* An offline mark is a word count, not a reading: say so where it
              can't be skimmed past as ordinary feedback. */}
          {feedback.verdict && (
            <p className={`mt-1 ${feedback.grader === "overlap" ? "font-medium text-amber-700" : "text-ink-soft"}`}>
              {feedback.verdict}
            </p>
          )}
          {/* Literal, not markdown: a MATH answer is an ASCII expression full
              of `*`, and CommonMark's intraword emphasis eats it. */}
          {!feedback.isCorrect && (
            <p>
              Correct answer: <code className="font-mono">{feedback.correctAnswer}</code>
            </p>
          )}
          {feedback.missing.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-ink-soft">
              {feedback.missing.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          {feedback.explanation && <p className="mt-1 text-ink-soft">{feedback.explanation}</p>}
          {requeued && <p className="mt-1 text-ink-soft">You&rsquo;ll see this one again before the end.</p>}
          {!feedback.isCorrect && !requeued && (
            <p className="mt-1 text-ink-soft">
              {MAX_MASTERY_ATTEMPTS} tries on this one — moving on. It&rsquo;s flagged in your results.
            </p>
          )}
          <Button size="sm" onClick={handleNext} className="mt-3">
            {index + 1 < queue.length ? "Next question" : "See results"}
            <kbd className="font-sans text-[10px] opacity-60" aria-hidden="true">
              Enter
            </kbd>
          </Button>
        </div>
      )}
    </div>
  );
}
