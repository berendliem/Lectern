"use client";

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
      className="w-full rounded-xl border border-slate-200 bg-white p-8 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {flipped ? "Reference explanation" : "Explain in your own words"}
      </p>
      <p className="text-lg text-slate-900">{flipped ? idealExplanation : prompt}</p>
      {!flipped && <p className="mt-4 text-xs text-slate-400">Click to reveal the reference explanation</p>}
    </button>
  );
}
