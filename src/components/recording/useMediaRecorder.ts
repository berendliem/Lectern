"use client";

import { useCallback, useRef, useState } from "react";

const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export type RecorderStatus = "idle" | "recording" | "paused" | "stopped";

export function useMediaRecorder() {
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

  const startRecording = useCallback(async () => {
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

      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
      setStatus("recording");
    } catch {
      setError("Microphone access was denied or is unavailable.");
    }
  }, [startLevelMeter, stopLevelMeter]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setStatus("stopped");
  }, []);

  const pauseRecording = useCallback(() => {
    mediaRecorderRef.current?.pause();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setStatus("paused");
  }, []);

  const resumeRecording = useCallback(() => {
    mediaRecorderRef.current?.resume();
    timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    setStatus("recording");
  }, []);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setElapsedSeconds(0);
    setStatus("idle");
  }, []);

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
  };
}
