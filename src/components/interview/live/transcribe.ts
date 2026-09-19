// src/components/interview/live/transcribe.ts
"use client";

import { useCallback, useReducer, useRef } from "react";
import { INITIAL_LIVE_STATE, liveReducer, type LiveAction, type LivePhase, type LiveState } from "@/lib/live-interview";

/**
 * Runs one utterance through the local transcriber (Whisper or mac-speech).
 * Null when it is unavailable or heard nothing; the caller falls back to the
 * browser's preview.
 */
export async function transcribe(sessionId: string, blob: Blob | null, turnId: string | null): Promise<string | null> {
  if (!blob) return null;
  const form = new FormData();
  form.append("file", blob, `answer.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
  if (turnId) form.append("turnId", turnId);
  const res = await fetch(`/api/interview/${sessionId}/transcribe-answer`, { method: "POST", body: form }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
  return typeof data?.text === "string" ? data.text : null;
}

/**
 * The turn reducer, plus a ref that holds the phase the moment an action is
 * dispatched. Async flows check it after every await; the rendered state lags
 * a frame behind, which is too late for "did the student cut in meanwhile?".
 */
export function useAct(): [LiveState, (action: LiveAction) => void, () => LivePhase] {
  const [state, dispatch] = useReducer(liveReducer, INITIAL_LIVE_STATE);
  const phase = useRef<LivePhase>(INITIAL_LIVE_STATE.phase);
  const act = useCallback((action: LiveAction) => {
    phase.current = liveReducer({ phase: phase.current, error: null }, action).phase;
    dispatch(action);
  }, []);
  // A getter, not the ref: TypeScript would keep a checked `phase.current` narrowed across awaits.
  const now = useCallback(() => phase.current, []);
  return [state, act, now];
}
