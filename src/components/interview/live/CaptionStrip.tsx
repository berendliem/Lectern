// src/components/interview/live/CaptionStrip.tsx
"use client";

import clsx from "@/lib/clsx";
import type { Caption } from "./useSpeechQueue";

/** Each debater keeps one colour, so the speaker is readable at a glance. */
const SPEAKER_TONE: Record<string, string> = {
  Proponent: "text-brand-ink",
  Skeptic: "text-lavender-ink",
};

/**
 * The line being spoken, with the current word highlighted. The highlight is a
 * state change, not an animation, so it stays on under reduced motion. Screen
 * readers get each finished sentence once, through the live region, instead
 * of a word-by-word flood.
 */
export function CaptionStrip({
  caption,
  student,
  lastSpoken,
  visible,
}: {
  caption: Caption | null;
  student: { text: string; interim: boolean } | null;
  lastSpoken: string;
  visible: boolean;
}) {
  return (
    <div className="min-h-[96px] rounded-2xl border border-line bg-surface px-5 py-4 shadow-sm">
      {visible && student && (
        <p className={clsx("text-[17px] leading-relaxed text-brand-ink", student.interim && "italic opacity-80")}>
          <span className="mr-2 text-[12px] font-semibold uppercase tracking-wide text-muted-2">You</span>
          {student.text}
        </p>
      )}
      {visible && !student && caption && (
        <p className="text-[17px] leading-relaxed">
          <span
            className={clsx(
              "mr-2 text-[12px] font-semibold uppercase tracking-wide",
              SPEAKER_TONE[caption.speaker] ?? "text-muted-2"
            )}
          >
            {caption.speaker}
          </span>
          {caption.sentence.split(/\s+/).filter(Boolean).map((word, i) => (
            <span
              key={i}
              className={clsx(
                "rounded px-0.5",
                i < caption.wordIndex && "text-ink",
                i === caption.wordIndex && "bg-brand-soft text-ink",
                i > caption.wordIndex && "text-muted-2"
              )}
            >
              {word}{" "}
            </span>
          ))}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {lastSpoken}
      </p>
    </div>
  );
}
