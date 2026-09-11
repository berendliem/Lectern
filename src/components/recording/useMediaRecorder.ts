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

function pickSupportedMimeType(): string | undefined {
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);

  // Live segment recorder state. Kept in refs (not state) because the cycle
  // is driven by recorder events, not renders.
  const onLiveSegmentRef = useRef(options?.onLiveSegment);
  const segmentRecorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentActiveRef = useRef(false);

  useEffect(() => {
    onLiveSegmentRef.current = options?.onLiveSegment;
  }, [options?.onLiveSegment]);

  const startSegmentLoop = useCallback((stream: MediaStream, mimeType: string | undefined) => {
    if (!onLiveSegmentRef.current) return;
    segmentActiveRef.current = true;

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
        // Roll straight into the next segment while the session is live.
        if (segmentActiveRef.current) spawnSegmentRecorder();
      };
      recorder.start();
      segmentRecorderRef.current = recorder;
    };

    spawnSegmentRecorder();
    segmentTimerRef.current = setInterval(() => {
      if (segmentRecorderRef.current?.state === "recording") {
        segmentRecorderRef.current.stop();
      }
    }, LIVE_SEGMENT_MS);
  }, []);

  const stopSegmentLoop = useCallback((flush: boolean) => {
    segmentActiveRef.current = false;
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

      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
      setStatus("recording");
      return true;
    } catch {
      setError("Microphone access was denied or is unavailable.");
      return false;
    }
  }, [startLevelMeter, stopLevelMeter, startSegmentLoop]);

  const stopRecording = useCallback(() => {
    stopSegmentLoop(true);
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setStatus("stopped");
  }, [stopSegmentLoop]);

  const pauseRecording = useCallback(() => {
    stopSegmentLoop(true);
    mediaRecorderRef.current?.pause();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setStatus("paused");
  }, [stopSegmentLoop]);

  const resumeRecording = useCallback(() => {
    mediaRecorderRef.current?.resume();
    if (streamRef.current) {
      startSegmentLoop(streamRef.current, pickSupportedMimeType());
    }
    timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    setStatus("recording");
  }, [startSegmentLoop]);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setElapsedSeconds(0);
    setStatus("idle");
  }, []);

  /**
   * Throws the take away and releases the microphone. `reset()` only clears
   * state — before this existed, the only thing that stopped the tracks was the
   * `onstop` handler of a completed recording, so an abandoned session kept the
   * mic open and the browser's recording indicator lit.
   */
  const discard = useCallback(() => {
    stopSegmentLoop(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
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
    setElapsedSeconds(0);
    setStatus("idle");
  }, [stopSegmentLoop, stopLevelMeter]);

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
