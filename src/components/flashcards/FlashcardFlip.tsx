"use client";

import clsx from "@/lib/clsx";

/**
 * Reveal-then-self-grade is the weakest form of retrieval practice: the honest
 * failure mode is recognising the answer and grading it Good. The textarea asks
 * for the attempt first — but it never blocks, because a review flow that
 * demands typing is a review flow that gets skipped.
 *
 * The card is a div rather than a button now: a textarea cannot live inside a
 * button, and the reveal moved to its own control at the foot of the card.
 */
export function FlashcardFlip({
  prompt,
  idealExplanation,
  flipped,
  onFlip,
  typed,
  onTyped,
  confidence,
  onConfidence,
  disabled = false,
}: {
  prompt: string;
  idealExplanation: string;
  flipped: boolean;
  onFlip: () => void;
  /** While a grade is being saved: hiding the card would hide the only sign of that. */
  disabled?: boolean;
  typed: string;
  onTyped: (value: string) => void;
  /** 1 Guessing · 2 Fairly sure · 3 Certain. Null while the student skips it. */
  confidence: number | null;
  onConfidence: (value: number | null) => void;
}) {
  return (
    <div
      className={clsx(
        "min-h-44 w-full rounded-2xl border p-8 text-left shadow-sm transition-shadow",
        flipped ? "border-brand-border bg-brand-soft/50" : "border-line bg-surface"
      )}
    >
      <p
        className={clsx(
          "mb-2 text-xs font-semibold uppercase tracking-wide",
          flipped ? "text-brand-ink" : "text-muted-2"
        )}
      >
        {flipped ? "Reference explanation" : "Explain in your own words"}
      </p>
      <p className="text-lg text-ink">{flipped ? idealExplanation : prompt}</p>

      {!flipped && (
        <div className="mt-5 flex flex-col gap-3">
          <textarea
            value={typed}
            onChange={(e) => onTyped(e.target.value)}
            rows={3}
            placeholder="Write what you remember — or leave this empty and just reveal."
            aria-label="Your answer before revealing"
            className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted-2 focus:border-brand-border focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted-2">How sure are you?</span>
            {[
              { value: 1, label: "Guessing" },
              { value: 2, label: "Fairly sure" },
              { value: 3, label: "Certain" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={confidence === option.value}
                // Clicking the selected one clears it: skipping is a real
                // answer and stores null, rather than a middling 2.
                onClick={() => onConfidence(confidence === option.value ? null : option.value)}
                className={clsx(
                  "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                  confidence === option.value
                    ? "border-brand-border bg-brand-soft text-brand-ink"
                    : "border-line text-muted hover:border-brand-border"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onFlip}
        disabled={disabled}
        className="mt-5 text-xs font-medium text-muted-2 hover:text-brand-ink disabled:opacity-50"
      >
        {flipped ? "Hide the reference explanation" : "Reveal the reference explanation"}
      </button>
    </div>
  );
}
