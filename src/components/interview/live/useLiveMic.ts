// src/components/interview/live/useLiveMic.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickSupportedMimeType } from "@/components/recording/useMediaRecorder";
import { SILENCE_MS, createVad } from "@/lib/live-interview";

type Handlers = {
  /** Sustained speech needed before "start"; Infinity ignores the mic (while transcribing or thinking). */
  onsetMs: () => number;
  onVad: (event: "start" | "end") => void;
};

/**
 * One open mic for the whole session. The level meter feeds the voice
 * detector every frame; a fresh recorder is armed for each utterance, so each
 * blob is one answer and holds none of the tutor's voice before it.
 */
export function useLiveMic(threshold: number, handlers: Handlers) {
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadRef = useRef(createVad({ threshold, silenceMs: SILENCE_MS }));
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });
  useEffect(() => {
    vadRef.current.setThreshold(threshold);
  }, [threshold]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    vadRef.current.reset();
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      // Echo cancellation is what lets the tutor talk while the mic listens for a barge-in.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      contextRef.current = context;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const level = data.reduce((sum, v) => sum + v, 0) / data.length / 255;
        const event = vadRef.current.step(level, performance.now(), handlersRef.current.onsetMs());
        if (event) handlersRef.current.onVad(event);
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();
      return true;
    } catch {
      setError("A live session needs the microphone. Allow it in the browser's site settings, or switch to typing.");
      stop();
      return false;
    }
  }, [stop]);

  /** Starts recording the next utterance, discarding anything not yet taken. */
  const arm = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const old = recorderRef.current;
    if (old && old.state !== "inactive") {
      old.onstop = null;
      old.stop();
    }
    chunksRef.current = [];
    const mimeType = pickSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(250);
    recorderRef.current = recorder;
  }, []);

  /** Stops the armed recorder and hands back what it heard. */
  const take = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const recorder = recorderRef.current;
        recorderRef.current = null;
        if (!recorder || recorder.state === "inactive") return resolve(null);
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          chunksRef.current = [];
          resolve(blob.size > 0 ? blob : null);
        };
        recorder.stop();
      }),
    []
  );

  useEffect(() => stop, [stop]);

  return { start, stop, arm, take, error };
}
