// src/components/interview/live/useSpeechQueue.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { say, silence } from "@/lib/speech";
import { createSentenceSplitter, spokenOffset } from "@/lib/live-text";

export type Voice = { voice: string; rate: number; lang: string };
export type Caption = { speaker: string; sentence: string; wordIndex: number };

type Queued = { text: string; speaker: string; voice: Voice };

/**
 * Speaks a streamed reply a sentence at a time and tracks the word being said,
 * so a barge-in can report exactly how much the student heard.
 */
export function useSpeechQueue() {
  const [caption, setCaption] = useState<Caption | null>(null);
  const [lastSpoken, setLastSpoken] = useState("");
  const queue = useRef<Queued[]>([]);
  const heard = useRef<string[]>([]);
  const current = useRef<{ text: string; wordIndex: number } | null>(null);
  const splitter = useRef(createSentenceSplitter());
  const speaker = useRef<{ name: string; voice: Voice } | null>(null);
  const playing = useRef(false);
  const ended = useRef(true);
  const muted = useRef(false);
  const waiters = useRef<(() => void)[]>([]);

  const settleIfIdle = useCallback(() => {
    if (playing.current || (queue.current.length > 0 && !muted.current) || !ended.current) return;
    const resolve = waiters.current;
    waiters.current = [];
    resolve.forEach((r) => r());
  }, []);

  const pump = useCallback(async () => {
    if (playing.current) return;
    playing.current = true;
    while (queue.current.length > 0 && !muted.current) {
      const item = queue.current.shift() as Queued;
      current.current = { text: item.text, wordIndex: 0 };
      setCaption({ speaker: item.speaker, sentence: item.text, wordIndex: 0 });
      const following = queue.current[0];
      const outcome = await say(item.text, {
        ...item.voice,
        next: following && following.speaker === item.speaker ? following.text : undefined,
        onWord: (wordIndex) => {
          if (current.current) current.current.wordIndex = wordIndex;
          setCaption((c) => (c ? { ...c, wordIndex } : c));
        },
      });
      if (outcome === "cancelled") break;
      heard.current.push(item.text);
      current.current = null;
      setLastSpoken(item.text);
    }
    playing.current = false;
    settleIfIdle();
  }, [settleIfIdle]);

  const enqueue = useCallback(
    (sentences: string[]) => {
      const who = speaker.current;
      if (!who || muted.current) return;
      for (const text of sentences) queue.current.push({ text, speaker: who.name, voice: who.voice });
      void pump();
    },
    [pump]
  );

  /** Starts a new reply: a fresh splitter, and a fresh count of what was heard. */
  const begin = useCallback((name: string, voice: Voice) => {
    speaker.current = { name, voice };
    splitter.current = createSentenceSplitter();
    heard.current = [];
    current.current = null;
    ended.current = false;
    muted.current = false;
  }, []);

  const push = useCallback((delta: string) => enqueue(splitter.current.push(delta)), [enqueue]);

  const end = useCallback(() => {
    enqueue(splitter.current.flush());
    ended.current = true;
    settleIfIdle();
  }, [enqueue, settleIfIdle]);

  const whenIdle = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiters.current.push(resolve);
        settleIfIdle();
      }),
    [settleIfIdle]
  );

  const speakAll = useCallback(
    async (name: string, voice: Voice, text: string) => {
      begin(name, voice);
      push(text);
      end();
      await whenIdle();
    },
    [begin, push, end, whenIdle]
  );

  /** Stops the voice mid-word and returns the offset, in the reply's normalized text, of what was heard. */
  const interrupt = useCallback((): number => {
    muted.current = true;
    queue.current = [];
    silence();
    const said = current.current;
    const offset = said
      ? spokenOffset([...heard.current, said.text], heard.current.length, said.wordIndex)
      : heard.current.join(" ").length;
    ended.current = true;
    settleIfIdle();
    return offset;
  }, [settleIfIdle]);

  const stopAll = useCallback(() => {
    muted.current = true;
    queue.current = [];
    ended.current = true;
    silence();
    setCaption(null);
    settleIfIdle();
  }, [settleIfIdle]);

  useEffect(() => () => silence(), []);

  return { caption, lastSpoken, begin, push, end, speakAll, interrupt, stopAll, whenIdle };
}
