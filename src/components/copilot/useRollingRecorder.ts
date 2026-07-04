"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CLIP_DURATION_MS } from "@/lib/copilot";

const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export type RollingRecorderStatus = "idle" | "recording" | "stopped";

/**
 * Records the microphone as a sequence of short, independently-decodable
 * clips instead of one continuous stream: MediaRecorder's chunks after the
 * first `dataavailable` event are NOT standalone-decodable webm/mp4 files, so
 * a single long recording can't be sliced for incremental transcription.
 * Instead we `stop()` a clip every CLIP_DURATION_MS (producing one complete
 * file) and immediately `start()` the next one, handing each finished blob to
 * `onClip` as it completes.
 */
export function useRollingRecorder(onClip: (blob: Blob, mimeType: string) => void) {
  const [status, setStatus] = useState<RollingRecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const onClipRef = useRef(onClip);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const clipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);
  // Holds the latest beginClip so the recursive "start the next clip" call
  // inside onstop doesn't reference beginClip before its own declaration.
  const beginClipRef = useRef<(stream: MediaStream, mimeType: string) => void>(() => {});

  useEffect(() => {
    onClipRef.current = onClip;
  }, [onClip]);

  const beginClip = useCallback((stream: MediaStream, mimeType: string) => {
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
      chunksRef.current = [];
      if (blob.size > 0) onClipRef.current(blob, mimeType || "audio/webm");

      if (stoppingRef.current) {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setStatus("stopped");
      } else if (streamRef.current) {
        beginClipRef.current(streamRef.current, mimeType);
      }
    };
    recorder.start();
    recorderRef.current = recorder;
  }, []);

  useEffect(() => {
    beginClipRef.current = beginClip;
  }, [beginClip]);

  const clearTimers = useCallback(() => {
    if (clipTimerRef.current) clearInterval(clipTimerRef.current);
    clipTimerRef.current = null;
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    stoppingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickSupportedMimeType();
      beginClip(stream, mimeType);

      clipTimerRef.current = setInterval(() => {
        recorderRef.current?.stop();
      }, CLIP_DURATION_MS);

      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
      setStatus("recording");
    } catch {
      setError("Microphone access was denied or is unavailable.");
      setStatus("idle");
    }
  }, [beginClip]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    clearTimers();
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, [clearTimers]);

  // Safety net: release the mic and timers if the component unmounts mid-session.
  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      clearTimers();
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [clearTimers]);

  return { status, elapsedSeconds, error, start, stop };
}
