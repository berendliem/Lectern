"use client";

import { useEffect, useRef } from "react";
import { ScrollText } from "lucide-react";

export function TranscriptPanel({
  transcript,
  isRecording,
}: {
  transcript: string;
  isRecording: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-200/80 bg-white">
      <div className="flex items-center gap-2 border-b border-zinc-200/80 px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-lavender-soft text-lavender-ink">
          <ScrollText className="h-4 w-4" strokeWidth={2} />
        </span>
        <h2 className="text-sm font-semibold text-zinc-900">Live transcript</h2>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {transcript ? (
          <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-zinc-700">{transcript}</p>
        ) : (
          <p className="text-[13px] text-zinc-400">
            {isRecording
              ? "Listening… transcribed text will appear here as clips are processed."
              : "Press Start to begin capturing and transcribing audio."}
          </p>
        )}
      </div>
    </div>
  );
}
