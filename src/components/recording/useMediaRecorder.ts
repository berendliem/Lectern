"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

// How often the live-preview segment recorder rolls over. Each segment is a
// complete, standalone audio file, so it can be transcribed on its own.
const LIVE_SEGMENT_MS = 15_000;

export function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export type RecorderStatus = "idle" | "recording" | "paused" | "stopped";

export function useMediaRecorder(options?: { onLiveSegment?: (blob: Blob) => void }) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock duration, not a tick count. Chrome throttles a background tab's
  // intervals to roughly one a minute, and leaving the page mid-recording is the
  // whole point of the shell recording bar — a counter that adds one per tick
  // would persist a few minutes for an hour-long lecture, against the user's
  // only copy of it, and skew the synced-transcript timeline with it.
  // `runStartedAtRef` is the Date.now() of the current recording stretch;
  // `accumulatedMsRef` is every stretch before this one (i.e. before a pause).
  const runStartedAtRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);

  // Live segment recorder state. Kept in refs (not state) because the cycle
  // is driven by recorder events, not renders.
  const onLiveSegmentRef = useRef(options?.onLiveSegment);
  const segmentRecorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentActiveRef = useRef(false);
  // Bumped by every stop and every start. `onstop` arrives asynchronously, so a
  // fast pause→resume would otherwise let the *old* recorder's handler spawn a
  // successor into the new loop — two live segment recorders, one of them held
  // by nothing and never stopped.
  const segmentGenerationRef = useRef(0);

  useEffect(() => {
    onLiveSegmentRef.current = options?.onLiveSegment;
  }, [options?.onLiveSegment]);

  const startSegmentLoop = useCallback((stream: MediaStream, mimeType: string | undefined) => {
    if (!onLiveSegmentRef.current) return;
    segmentActiveRef.current = true;
    const generation = ++segmentGenerationRef.current;

    const spawnSegmentRecorder = () => {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const segmentChunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) segmentChunks.push(e.data);
      };
      recorder.onstop = () => {
        if (segmentChunks.length > 0) {
          onLiveSegmentRef.current?.(new Blob(segmentChunks, { type: mimeType ?? "audio/webm" }));
        }
        // Roll straight into the next segment while this loop is the live one.
        if (segmentActiveRef.current && segmentGenerationRef.current === generation) {
          spawnSegmentRecorder();
        }
      };
      recorder.start();
      segmentRecorderRef.current = recorder;
    };

    spawnSegmentRecorder();
    if (segmentTimerRef.current) clearInterval(segmentTimerRef.current);
    segmentTimerRef.current = setInterval(() => {
      if (segmentRecorderRef.current?.state === "recording") {
        segmentRecorderRef.current.stop();
      }
    }, LIVE_SEGMENT_MS);
  }, []);

  const stopSegmentLoop = useCallback((flush: boolean) => {
    segmentActiveRef.current = false;
    segmentGenerationRef.current += 1;
    if (segmentTimerRef.current) clearInterval(segmentTimerRef.current);
    segmentTimerRef.current = null;
    const recorder = segmentRecorderRef.current;
    segmentRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      if (flush) recorder.stop();
      else {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
    }
  }, []);

  /**
   * The interval is only a render tick: every value it publishes is read off
   * the clock, so a starved timer shows a stale number for a moment and then
   * catches up, instead of losing the time it never got to count.
   */
  const startElapsedTicker = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const running = runStartedAtRef.current === null ? 0 : Date.now() - runStartedAtRef.current;
      setElapsedSeconds(Math.floor((accumulatedMsRef.current + running) / 1000));
    }, 1000);
  }, []);

  /** Closes the current stretch and publishes the exact total, for pause/stop. */
  const bankElapsed = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (runStartedAtRef.current !== null) {
      accumulatedMsRef.current += Date.now() - runStartedAtRef.current;
      runStartedAtRef.current = null;
    }
    setElapsedSeconds(Math.floor(accumulatedMsRef.current / 1000));
  }, []);

  const clearElapsed = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    runStartedAtRef.current = null;
    accumulatedMsRef.current = 0;
    setElapsedSeconds(0);
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setLevel(0);
  }, []);

  const startLevelMeter = useCallback((stream: MediaStream) => {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioContext = new AudioCtx();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    audioContextRef.current = audioContext;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
      setLevel(avg / 255);
      animationRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const startRecording = useCallback(async (): Promise<boolean> => {
    setError(null);
    setAudioBlob(null);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType ?? "audio/webm" });
        setAudioBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
        stopLevelMeter();
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      startLevelMeter(stream);
      startSegmentLoop(stream, mimeType);

      accumulatedMsRef.current = 0;
      runStartedAtRef.current = Date.now();
      setElapsedSeconds(0);
      startElapsedTicker();
      setStatus("recording");
      return true;
    } catch {
      setError("Microphone access was denied or is unavailable.");
      return false;
    }
  }, [startLevelMeter, stopLevelMeter, startSegmentLoop, startElapsedTicker]);

  const stopRecording = useCallback(() => {
    stopSegmentLoop(true);
    mediaRecorderRef.current?.stop();
    bankElapsed();
    setStatus("stopped");
  }, [stopSegmentLoop, bankElapsed]);

  const pauseRecording = useCallback(() => {
    stopSegmentLoop(true);
    mediaRecorderRef.current?.pause();
    bankElapsed();
    setStatus("paused");
  }, [stopSegmentLoop, bankElapsed]);

  const resumeRecording = useCallback(() => {
    mediaRecorderRef.current?.resume();
    if (streamRef.current) {
      startSegmentLoop(streamRef.current, pickSupportedMimeType());
    }
    runStartedAtRef.current = Date.now();
    startElapsedTicker();
    setStatus("recording");
  }, [startSegmentLoop, startElapsedTicker]);

  const reset = useCallback(() => {
    setAudioBlob(null);
    clearElapsed();
    setStatus("idle");
  }, [clearElapsed]);

  /**
   * Throws the take away and releases the microphone. `reset()` only clears
   * state — before this existed, the only thing that stopped the tracks was the
   * `onstop` handler of a completed recording, so an abandoned session kept the
   * mic open and the browser's recording indicator lit.
   */
  const discard = useCallback(() => {
    stopSegmentLoop(false);
    clearElapsed();
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      // Drop the assembling handlers first: this take is not being saved.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
    stopLevelMeter();
    setAudioBlob(null);
    setStatus("idle");
  }, [stopSegmentLoop, stopLevelMeter, clearElapsed]);

  return {
    status,
    elapsedSeconds,
    audioBlob,
    level,
    error,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    reset,
    discard,
  };
}
