// src/lib/live-interview.ts
import { z } from "zod";
import { rubricFor, type InterviewFeedback, type Rubric } from "@/lib/interview";
import type { feynmanFeedbackSchema } from "@/lib/validation";

export type FeynmanFeedback = z.infer<typeof feynmanFeedbackSchema>;

export const VERDICTS = ["right", "partial", "wrong"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type TranscriptSource = "whisper" | "browser";

/** What a live turn stores in `InterviewTurn.feedback`. */
export type LiveFeedback = {
  score: number;
  verdict: Verdict;
  improvement: string;
  correction: string;
  example: string;
  transcriptSource?: TranscriptSource;
};

/** The JSON after the `@@GRADE` marker. The score keeps its grader's scale, as `recallRawFor` expects. */
export function liveGradeSchema(mode: "VIVA" | "PROTEGE") {
  const score =
    rubricFor(mode) === "FEYNMAN" ? z.number().min(0).max(100) : z.number().int().min(1).max(5);
  return z.object({
    score,
    verdict: z.enum(VERDICTS),
    improvement: z.string().trim().max(600).default(""),
    correction: z.string().trim().max(1200).default(""),
    example: z.string().trim().max(2000).default(""),
    nextQuestion: z.string().trim().min(1).max(600).nullable().default(null),
  });
}

/** Past this a streamed reply is a runaway, not an answer: the route stops and fails it. */
export const MAX_LIVE_REPLY_CHARS = 8000;

export const liveTurnSchema = z.object({
  turnId: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(4000),
  transcriptSource: z.enum(["whisper", "browser"]).default("whisper"),
});

export const liveInterruptSchema = z.object({
  turnId: z.string().trim().min(1),
  interruptedAt: z.number().int().min(0).max(20000),
});

export const liveToggleSchema = z.object({ live: z.boolean() });

export function verdictFromScore(rubric: Rubric, score: number): Verdict {
  if (rubric === "FEYNMAN") return score >= 75 ? "right" : score >= 50 ? "partial" : "wrong";
  return score >= 4 ? "right" : score === 3 ? "partial" : "wrong";
}

/** The fallback grader and debate interjections produce the typed-mode shapes; this reads them as a live grade. */
export function toLiveFeedback(graded: InterviewFeedback | FeynmanFeedback): LiveFeedback {
  if ("modelAnswer" in graded) {
    const first = graded.improvements[0] ?? "";
    return {
      score: graded.score,
      verdict: verdictFromScore("INTERVIEWER", graded.score),
      improvement: first,
      correction: first,
      example: graded.modelAnswer,
    };
  }
  const first = graded.gaps[0] ?? "";
  return {
    score: graded.score,
    verdict: verdictFromScore("FEYNMAN", graded.score),
    improvement: first,
    correction: first,
    example: "",
  };
}

/**
 * Stored feedback in any of its shapes: a live grade, the interviewer's, or
 * the Feynman coach's. A session can switch between typing and talking, so
 * one transcript can hold all three.
 */
export function readLiveFeedback(json: string | null): LiveFeedback | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.score !== "number") return null;
  if (typeof o.verdict === "string" && (VERDICTS as readonly string[]).includes(o.verdict) && typeof o.correction === "string") {
    return o as unknown as LiveFeedback;
  }
  if (typeof o.modelAnswer === "string" && Array.isArray(o.improvements)) {
    return toLiveFeedback(o as unknown as InterviewFeedback);
  }
  if (Array.isArray(o.gaps)) {
    return toLiveFeedback({ score: o.score, gaps: o.gaps as string[] } as FeynmanFeedback);
  }
  return null;
}

/** A missed question earns one variant; a missed variant does not earn another. */
export function nextTurnKind(verdict: Verdict, answeringRetry: boolean): "retry" | "new" {
  return verdict !== "right" && !answeringRetry ? "retry" : "new";
}

/** Retries are a second go at the same question, so they don't use up the session's questions. */
export function questionsAnswered(turns: { answer: string | null; retryOf: string | null }[]): number {
  return turns.filter((t) => t.answer !== null && t.retryOf === null).length;
}

export const SILENCE_MS = 1200;
export const LISTEN_ONSET_MS = 150;
export const BARGE_IN_MS = 300;
export const DEFAULT_SENSITIVITY = 0.5;

/**
 * Slider position (0 = deaf, 1 = twitchy) to a level threshold on the 0..1
 * scale the analyser reports.
 * ponytail: linear guess from one laptop mic; the slider is the calibration knob.
 */
export function sensitivityToThreshold(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 0.2 - s * 0.17;
}

/**
 * Energy-based voice detection. The onset is passed per step because the same
 * mic needs a quick trigger while listening and a slower one while the tutor
 * talks, where a cough should not count as cutting in.
 */
export function createVad(config: { threshold: number; silenceMs: number }) {
  let threshold = config.threshold;
  let speaking = false;
  let aboveSince: number | null = null;
  let belowSince: number | null = null;
  return {
    step(level: number, now: number, onsetMs: number): "start" | "end" | null {
      if (level >= threshold) {
        belowSince = null;
        if (speaking) return null;
        aboveSince ??= now;
        if (now - aboveSince >= onsetMs) {
          speaking = true;
          aboveSince = null;
          return "start";
        }
        return null;
      }
      aboveSince = null;
      if (!speaking) return null;
      belowSince ??= now;
      if (now - belowSince >= config.silenceMs) {
        speaking = false;
        belowSince = null;
        return "end";
      }
      return null;
    },
    reset() {
      speaking = false;
      aboveSince = null;
      belowSince = null;
    },
    setThreshold(next: number) {
      threshold = next;
    },
  };
}

export type LivePhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error" | "done";
export type LiveState = { phase: LivePhase; error: string | null };
export const INITIAL_LIVE_STATE: LiveState = { phase: "idle", error: null };

export type LiveAction =
  | { type: "start" }
  | { type: "advance" }
  | { type: "speechEnd" }
  | { type: "transcribed" }
  | { type: "empty" }
  | { type: "replyStarted" }
  | { type: "replyDone"; completed: boolean }
  | { type: "bargeIn" }
  | { type: "failed"; message: string }
  | { type: "retry" }
  | { type: "end" };

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  const to = (phase: LivePhase, error: string | null = null): LiveState => ({ phase, error });
  if (action.type === "end") return to("done");
  switch (state.phase) {
    case "idle":
      if (action.type === "start") return to("speaking");
      if (action.type === "advance") return to("thinking");
      return state;
    case "listening":
      if (action.type === "speechEnd") return to("transcribing");
      if (action.type === "advance") return to("thinking");
      // A reply that was still in flight when the student barged in can still fail.
      if (action.type === "failed") return to("error", action.message);
      return state;
    case "transcribing":
      if (action.type === "transcribed") return to("thinking");
      if (action.type === "empty") return to("speaking");
      if (action.type === "failed") return to("error", action.message);
      return state;
    case "thinking":
      if (action.type === "replyStarted") return to("speaking");
      if (action.type === "failed") return to("error", action.message);
      return state;
    case "speaking":
      if (action.type === "bargeIn") return to("listening");
      if (action.type === "replyDone") return to(action.completed ? "done" : "listening");
      if (action.type === "failed") return to("error", action.message);
      return state;
    case "error":
      return action.type === "retry" ? to("thinking") : state;
    case "done":
      return state;
  }
}

export function isEndCommand(text: string): boolean {
  return /^\s*(please\s+)?(end|stop|finish)\s+(the\s+)?(session|interview|debate)[.!]?\s*$/i.test(text);
}

/**
 * The answer to save and grade: the local transcription when it produced
 * anything, else Chrome's preview, marked as such for the transcript.
 */
export function heardAnswer(local: string | null, preview: string): { text: string; source: TranscriptSource } | null {
  const fromLocal = local?.trim();
  if (fromLocal) return { text: fromLocal.slice(0, 4000), source: "whisper" };
  const fromPreview = preview.trim();
  return fromPreview ? { text: fromPreview.slice(0, 4000), source: "browser" } : null;
}

export type LiveNextTurn = { id: string; order: number; question: string; retryOf: string | null };

/** NDJSON events from `POST /api/interview/[id]/live-turn`. */
export type LiveTurnEvent =
  | { type: "text"; delta: string }
  | { type: "done"; verdict: Verdict; completed: boolean; nextTurn: LiveNextTurn | null }
  | { type: "error"; message: string };

export type DebateLiveTurn = { id: string; order: number; speaker: string; question: string };

/** NDJSON events from `POST /api/interview/[id]/debate/live`. */
export type DebateLiveEvent =
  | { type: "speaker"; speaker: string; order: number }
  | { type: "text"; delta: string }
  | { type: "done"; turn: DebateLiveTurn | null; finished: boolean }
  | { type: "error"; message: string };
