// src/components/interview/live/useBrowserRecognition.ts
"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// The Web Speech recognizer is not in TypeScript's DOM lib; this is the slice used here.
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscription = () => () => {};

/**
 * Interim captions of the student's own speech. Chrome sends this audio to
 * Google; the text shown here is only a preview, and what gets saved and
 * graded comes from the local transcription of the recording.
 */
export function useBrowserRecognition(lang = "en-US") {
  const supported = useSyncExternalStore(noSubscription, () => recognitionCtor() !== null, () => false);
  const [text, setText] = useState("");
  const recognitionRef = useRef<Recognition | null>(null);
  const wantedRef = useRef(false);

  const begin = useCallback(
    function begin() {
      const Ctor = recognitionCtor();
      if (!Ctor) return;
      wantedRef.current = true;
      setText("");
      if (recognitionRef.current) {
        // Restarting is the only way to clear the results of the previous utterance.
        recognitionRef.current.abort();
        return;
      }
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;
      recognition.onresult = (event) => {
        let heard = "";
        for (let i = 0; i < event.results.length; i++) heard += event.results[i][0].transcript;
        setText(heard);
      };
      // Chrome ends a continuous session on its own after a pause; carry on while wanted.
      recognition.onend = () => {
        recognitionRef.current = null;
        if (wantedRef.current) begin();
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") wantedRef.current = false;
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
      }
    },
    [lang]
  );

  const end = useCallback(() => {
    wantedRef.current = false;
    recognitionRef.current?.stop();
    setText("");
  }, []);

  useEffect(
    () => () => {
      wantedRef.current = false;
      recognitionRef.current?.abort();
    },
    []
  );

  return { supported, text, begin, end };
}
