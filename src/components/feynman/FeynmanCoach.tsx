"use client";

import { useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Lightbulb,
  Loader2,
  Mic,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import clsx from "@/lib/clsx";

type Feedback = {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  jargon: string[];
  followUp: string;
};

type Round = { explanation: string; feedback: Feedback };

const EXAMPLES = [
  "How does photosynthesis work?",
  "What is opportunity cost?",
  "Why is the sky blue?",
  "What does a for-loop do?",
];

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

export function FeynmanCoach({
  suggestions = EXAMPLES,
  initialReference = "",
  contextLabel,
  pageId,
}: {
  /** Concepts to offer as one-click starters — a lecture's key terms or a course's syllabus topics. */
  suggestions?: string[];
  /** Pre-filled ground truth, e.g. the lecture's notes. */
  initialReference?: string;
  /** "Lecture 4 — Recursion", shown so it's obvious what the coach is grading against. */
  contextLabel?: string;
  /** The lecture this was launched from; it hangs the graded attempt off that
   * lecture in the recall ledger. Absent when the coach was opened on its own. */
  pageId?: string;
}) {
  const [concept, setConcept] = useState("");
  const [reference, setReference] = useState(initialReference);
  const [showReference, setShowReference] = useState(initialReference.length > 0);
  const [explanation, setExplanation] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime ?? "audio/webm" });
        await transcribe(blob);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setError("Microphone access was denied or is unavailable. You can type your explanation instead.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function transcribe(blob: Blob) {
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append("file", blob, "explanation.webm");
      const res = await fetch("/api/live-transcribe", { method: "POST", body: fd });
      if (res.ok) {
        const { text } = await res.json();
        const clean = (text ?? "").trim();
        if (clean) setExplanation((prev) => (prev ? `${prev.trim()} ${clean}` : clean));
      } else {
        setError("Could not transcribe your voice. Type your explanation instead.");
      }
    } catch {
      setError("Could not transcribe your voice. Type your explanation instead.");
    } finally {
      setTranscribing(false);
    }
  }

  async function submit() {
    const c = concept.trim();
    const e = explanation.trim();
    if (!c || !e || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/feynman/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept: c,
          reference: reference.trim() || undefined,
          explanation: e,
          priorExplanations: rounds.map((r) => r.explanation),
          pageId,
        }),
      });
      if (res.ok) {
        const { feedback } = await res.json();
        setRounds((r) => [...r, { explanation: e, feedback }]);
        setExplanation("");
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "The coach couldn't evaluate that. Please try again.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = concept.trim() && explanation.trim() && !loading;
  const started = rounds.length > 0;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Lightbulb className="h-6 w-6 text-brand-ink" strokeWidth={2.2} />
          Feynman coach
        </h1>
        <p className="mt-0.5 text-[13px] text-muted">
          If you can&apos;t explain it simply, you don&apos;t understand it yet. Explain a concept in plain words — by voice
          or text — and get scored on clarity, gaps, and hidden jargon.
        </p>
        {contextLabel && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[12.5px] font-medium text-brand-ink">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={2.2} /> {contextLabel}
          </p>
        )}
      </div>

      {/* Concept + optional reference */}
      <div className="flex flex-col gap-3 rounded-2xl border border-line/80 bg-surface p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Concept to master</span>
          <input
            value={concept}
            onChange={(ev) => setConcept(ev.target.value)}
            placeholder="e.g. How does a neural network learn?"
            className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </label>

        {!started && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((ex) => (
              <button
                key={ex}
                onClick={() => setConcept(ex)}
                className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs text-ink-soft transition-colors hover:border-brand-border hover:bg-brand-soft/50 hover:text-brand-ink"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {showReference ? (
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
              <BookOpen className="h-3.5 w-3.5" strokeWidth={2.2} /> Reference material (optional — the ground truth)
            </span>
            <textarea
              value={reference}
              onChange={(ev) => setReference(ev.target.value)}
              rows={4}
              placeholder="Paste your notes or the textbook passage so the coach can check your explanation for accuracy and completeness…"
              className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </label>
        ) : (
          <button
            onClick={() => setShowReference(true)}
            className="self-start text-[13px] font-medium text-brand-ink hover:underline"
          >
            + Add reference material to check accuracy
          </button>
        )}
      </div>

      {/* Previous rounds */}
      {rounds.map((round, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="self-end max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[13.5px] leading-6 text-surface">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-surface/50">
              Attempt {i + 1}
            </span>
            {round.explanation}
          </div>
          <FeedbackCard feedback={round.feedback} />
        </div>
      ))}

      {/* Explanation composer */}
      <div className="flex flex-col gap-2.5 rounded-2xl border border-brand-border bg-brand-soft p-5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink">
          {started ? "Refine your explanation" : "Explain it simply, as if to a curious 12-year-old"}
        </span>
        <textarea
          value={explanation}
          onChange={(ev) => setExplanation(ev.target.value)}
          rows={5}
          placeholder="Start explaining… use everyday words and an analogy if you can. Tap the mic to speak instead of type."
          className="w-full resize-y rounded-xl border border-line-strong bg-surface px-3.5 py-3 text-sm leading-6 text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-gold"
        />
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={transcribing}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50",
              recording
                ? "bg-red-600 text-white hover:bg-red-500"
                : "border border-line bg-surface text-ink-soft hover:border-line-strong hover:bg-surface-2"
            )}
          >
            {transcribing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} /> Transcribing…
              </>
            ) : recording ? (
              <>
                <Square className="h-4 w-4 fill-current" strokeWidth={2.2} /> Stop &amp; transcribe
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" strokeWidth={2.2} /> Speak
              </>
            )}
          </button>
          {recording && (
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-red-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" /> Recording
            </span>
          )}
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <Send className="h-4 w-4" strokeWidth={2.2} />}
            {started ? "Score again" : "Get feedback"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <div ref={endRef} />
    </div>
  );
}

function scoreBand(score: number): { ring: string; text: string; label: string } {
  if (score >= 80) return { ring: "#059669", text: "text-moss-ink", label: "Crystal clear" };
  if (score >= 55) return { ring: "#d97706", text: "text-daisy-ink", label: "Getting there" };
  return { ring: "#dc2626", text: "text-coral-ink", label: "Needs work" };
}

function ScoreRing({ score }: { score: number }) {
  const band = scoreBand(score);
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e4e4e7" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={band.ring}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - Math.min(1, Math.max(0, score / 100)))}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={clsx("text-lg font-bold tabular-nums", band.text)}>{score}</span>
      </div>
    </div>
  );
}

function FeedbackList({
  title,
  items,
  icon: Icon,
  tone,
}: {
  title: string;
  items: string[];
  icon: typeof Check;
  tone: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={clsx("mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide", tone)}>
        <Icon className="h-3.5 w-3.5" strokeWidth={2.4} /> {title}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-[13.5px] leading-6 text-ink-soft">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-300" />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeedbackCard({ feedback }: { feedback: Feedback }) {
  const band = scoreBand(feedback.score);
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line/80 bg-surface p-5">
      <div className="flex items-center gap-4">
        <ScoreRing score={feedback.score} />
        <div>
          <p className={clsx("text-sm font-semibold", band.text)}>{band.label}</p>
          <p className="mt-0.5 text-[13.5px] leading-6 text-ink-soft">{feedback.verdict}</p>
        </div>
      </div>

      <FeedbackList title="What you nailed" items={feedback.strengths} icon={Check} tone="text-moss-ink" />
      <FeedbackList title="Gaps to close" items={feedback.gaps} icon={TriangleAlert} tone="text-coral-ink" />
      <FeedbackList title="Jargon to simplify" items={feedback.jargon} icon={Sparkles} tone="text-daisy-ink" />

      {feedback.followUp && (
        <div className="rounded-xl bg-sky-soft/60 p-3.5">
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-sky-ink">
            <Lightbulb className="h-3.5 w-3.5" strokeWidth={2.4} /> Push deeper
          </p>
          <p className="text-[13.5px] leading-6 text-ink-soft">{feedback.followUp}</p>
        </div>
      )}
    </div>
  );
}
