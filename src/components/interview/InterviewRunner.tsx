"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  Lightbulb,
  Loader2,
  Mic,
  Send,
  Square,
  Trophy,
} from "lucide-react";
import { useMediaRecorder } from "@/components/recording/useMediaRecorder";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { averageScore, type InterviewFeedback } from "@/lib/interview";
import { DebateRunner } from "@/components/interview/DebateRunner";
import clsx from "@/lib/clsx";

type Turn = {
  id: string;
  order: number;
  speaker: string | null;
  question: string;
  answer: string | null;
  feedback: string | null;
};

type AnsweredTurn = { question: string; answer: string; feedback: InterviewFeedback };

function parseAnswered(turns: Turn[]): AnsweredTurn[] {
  return turns
    .filter((t) => t.answer !== null && t.feedback !== null)
    .map((t) => ({
      question: t.question,
      answer: t.answer as string,
      feedback: JSON.parse(t.feedback as string) as InterviewFeedback,
    }));
}

export function InterviewRunner({
  sessionId,
  title,
  concept,
  mode,
  status,
  initialTurns,
  totalQuestions,
}: {
  sessionId: string;
  title: string;
  concept: string;
  mode: "VIVA" | "PROTEGE" | "DEBATE";
  status: "ACTIVE" | "COMPLETED";
  initialTurns: Turn[];
  totalQuestions: number;
}) {
  // A debate is not a question/answer loop, so it gets its own runner before
  // any of that loop's state is set up. VIVA and PROTEGE stay on the path
  // below — a protege session is the same loop with a different voice.
  if (mode === "DEBATE") {
    return <DebateRunner sessionId={sessionId} concept={concept} initialTurns={initialTurns} status={status} />;
  }
  return (
    <VivaRunner
      sessionId={sessionId}
      title={title}
      status={status}
      initialTurns={initialTurns}
      totalQuestions={totalQuestions}
    />
  );
}

function VivaRunner({
  sessionId,
  title,
  status,
  initialTurns,
  totalQuestions,
}: {
  sessionId: string;
  title: string;
  status: "ACTIVE" | "COMPLETED";
  initialTurns: Turn[];
  totalQuestions: number;
}) {
  const [history, setHistory] = useState<AnsweredTurn[]>(() => parseAnswered(initialTurns));
  const [current, setCurrent] = useState<Turn | null>(
    () => initialTurns.find((t) => t.answer === null) ?? null
  );
  const [completed, setCompleted] = useState(status === "COMPLETED" && !initialTurns.some((t) => t.answer === null));

  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After submitting, we hold the feedback + what comes next until the user
  // clicks "Next question", so they can read the coaching first.
  const [reviewing, setReviewing] = useState<InterviewFeedback | null>(null);
  const [pendingIsLast, setPendingIsLast] = useState(false);
  const pendingNextRef = useRef<Turn | null>(null);
  const pendingCompleteRef = useRef(false);

  const recorder = useMediaRecorder();
  const [transcribing, setTranscribing] = useState(false);
  const lastBlobRef = useRef<Blob | null>(null);

  // When a voice answer finishes recording, transcribe it into the textarea.
  useEffect(() => {
    const blob = recorder.audioBlob;
    if (!blob || blob === lastBlobRef.current) return;
    lastBlobRef.current = blob;

    let ignore = false;
    setTranscribing(true);
    const form = new FormData();
    form.append("file", blob, "answer.webm");
    if (current) form.append("turnId", current.id);
    fetch(`/api/interview/${sessionId}/transcribe-answer`, { method: "POST", body: form })
      .then((res) => res.json())
      .then((data) => {
        if (ignore) return;
        if (typeof data.text === "string" && data.text.trim()) {
          setAnswer((prev) => (prev.trim() ? `${prev.trim()} ${data.text.trim()}` : data.text.trim()));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!ignore) setTranscribing(false);
      });
    return () => {
      ignore = true;
    };
  }, [recorder.audioBlob, sessionId, current]);

  async function submitAnswer() {
    if (!current || !answer.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview/${sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId: current.id, answer: answer.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong grading your answer.");
        return;
      }
      const feedback = data.feedback as InterviewFeedback;
      setHistory((h) => [...h, { question: current.question, answer: answer.trim(), feedback }]);
      pendingNextRef.current = data.nextTurn ?? null;
      pendingCompleteRef.current = !!data.completed;
      setPendingIsLast(!!data.completed || !data.nextTurn);
      setReviewing(feedback);
      recorder.reset();
      lastBlobRef.current = null;
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSubmitting(false);
    }
  }

  function advance() {
    setReviewing(null);
    setAnswer("");
    if (pendingCompleteRef.current || !pendingNextRef.current) {
      setCompleted(true);
      setCurrent(null);
    } else {
      setCurrent(pendingNextRef.current);
    }
    pendingNextRef.current = null;
    pendingCompleteRef.current = false;
  }

  if (completed) {
    const avg = averageScore(history.map((h) => h.feedback.score));
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-brand-border bg-gradient-to-br from-brand-soft to-lavender-soft/60 px-4 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-brand-ink shadow-sm">
            <Trophy className="h-6 w-6" strokeWidth={2} />
          </span>
          <p className="text-lg font-semibold text-ink">Interview complete</p>
          <p className="text-sm text-ink-soft">
            {history.length} question{history.length === 1 ? "" : "s"} · average score{" "}
            <span className="font-semibold text-brand-ink">{avg.toFixed(1)}/5</span>
          </p>
          <Link href="/interview" className="mt-1 text-[13px] font-medium text-brand-ink hover:underline">
            Start another interview
          </Link>
        </div>
        <div className="flex flex-col gap-3">
          {history.map((h, i) => (
            <ReviewCard key={i} index={i} question={h.question} answer={h.answer} feedback={h.feedback} />
          ))}
        </div>
      </div>
    );
  }

  if (!current) {
    return <p className="text-sm text-muted-2">Loading…</p>;
  }

  const answeredCount = history.length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-2">
          <span>
            Question {answeredCount + 1} of {totalQuestions}
          </span>
          <span className="truncate font-medium">{title}</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-[#9b5cff] transition-all"
            style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-line/80 bg-surface p-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-ink">Interviewer</p>
        <p className="text-lg leading-7 text-ink">{current.question}</p>
      </div>

      {reviewing ? (
        <div className="flex flex-col gap-4">
          <FeedbackBlock feedback={reviewing} />
          <Button variant="brand" onClick={advance} className="self-start">
            {pendingIsLast ? "See results" : "Next question"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Textarea
            rows={5}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Speak your answer with the mic, or type it here…"
            disabled={submitting}
          />
          <div className="flex flex-wrap items-center gap-2">
            {recorder.status === "recording" ? (
              <Button variant="danger" size="sm" onClick={recorder.stopRecording}>
                <Square className="h-3.5 w-3.5" strokeWidth={2.5} />
                Stop ({recorder.elapsedSeconds}s)
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={recorder.startRecording} disabled={submitting || transcribing}>
                <Mic className="h-4 w-4" strokeWidth={2} />
                {transcribing ? "Transcribing…" : "Record answer"}
              </Button>
            )}
            <Button variant="brand" size="sm" onClick={submitAnswer} disabled={submitting || !answer.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Send className="h-4 w-4" strokeWidth={2} />}
              {submitting ? "Grading…" : "Submit answer"}
            </Button>
            {recorder.error && <span className="text-[13px] text-blush-ink">{recorder.error}</span>}
          </div>
          {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}

function FeedbackBlock({ feedback }: { feedback: InterviewFeedback }) {
  const [showModel, setShowModel] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line/80 bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Feedback</p>
        <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-ink">
          {feedback.score}/5
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-moss-soft/40 p-3">
          <p className="mb-1.5 text-xs font-semibold text-moss-ink">Strengths</p>
          <ul className="flex flex-col gap-1">
            {feedback.strengths.map((s, i) => (
              <li key={i} className="flex gap-1.5 text-[13px] leading-5 text-ink-soft">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-moss-ink" strokeWidth={2.5} />
                {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-daisy-soft/40 p-3">
          <p className="mb-1.5 text-xs font-semibold text-daisy-ink">To improve</p>
          <ul className="flex flex-col gap-1">
            {feedback.improvements.map((s, i) => (
              <li key={i} className="flex gap-1.5 text-[13px] leading-5 text-ink-soft">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-daisy-ink" strokeWidth={2} />
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <button
        onClick={() => setShowModel((v) => !v)}
        className="flex items-center gap-1 self-start text-[13px] font-medium text-brand-ink hover:underline"
      >
        <ChevronDown className={clsx("h-4 w-4 transition-transform", showModel && "rotate-180")} strokeWidth={2} />
        {showModel ? "Hide model answer" : "Show model answer"}
      </button>
      {showModel && <p className="rounded-xl bg-surface-2 p-3 text-[13px] leading-6 text-ink-soft">{feedback.modelAnswer}</p>}
    </div>
  );
}

function ReviewCard({
  index,
  question,
  answer,
  feedback,
}: {
  index: number;
  question: string;
  answer: string;
  feedback: InterviewFeedback;
}) {
  return (
    <div className="rounded-2xl border border-line/80 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink">
          <span className="text-muted-2">Q{index + 1}.</span> {question}
        </p>
        <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink">
          {feedback.score}/5
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-5 text-muted">
        <span className="font-medium text-ink-soft">Your answer:</span> {answer}
      </p>
    </div>
  );
}
