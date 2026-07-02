"use client";

import clsx from "@/lib/clsx";

export function FlashcardFlip({
  prompt,
  idealExplanation,
  flipped,
  onFlip,
}: {
  prompt: string;
  idealExplanation: string;
  flipped: boolean;
  onFlip: () => void;
}) {
  return (
    <button
      onClick={onFlip}
      className={clsx(
        "w-full rounded-2xl border p-8 text-left shadow-sm transition-shadow hover:shadow-md",
        flipped ? "border-brand-border bg-brand-soft/50" : "border-zinc-200 bg-white"
      )}
    >
      <p
        className={clsx(
          "mb-2 text-xs font-semibold uppercase tracking-wide",
          flipped ? "text-brand" : "text-zinc-400"
        )}
      >
        {flipped ? "Reference explanation" : "Explain in your own words"}
      </p>
      <p className="text-lg text-zinc-900">{flipped ? idealExplanation : prompt}</p>
      {!flipped && <p className="mt-4 text-xs text-zinc-400">Click to reveal the reference explanation</p>}
    </button>
  );
}
