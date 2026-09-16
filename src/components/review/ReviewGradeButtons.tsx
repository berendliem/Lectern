/** In order, so the digit keys 1–4 map onto them by position. */
export const GRADES: { label: string; sublabel: string; quality: number; classes: string }[] = [
  {
    label: "Again",
    sublabel: "Forgot it",
    quality: 0,
    classes: "border-blush bg-blush-soft/60 text-blush-ink hover:bg-blush-soft",
  },
  {
    label: "Hard",
    sublabel: "Struggled",
    quality: 3,
    classes: "border-daisy bg-daisy-soft/60 text-daisy-ink hover:bg-daisy-soft",
  },
  {
    label: "Good",
    sublabel: "Got it",
    quality: 4,
    classes: "border-moss bg-moss-soft/60 text-moss-ink hover:bg-moss-soft",
  },
  {
    label: "Easy",
    sublabel: "Instant",
    quality: 5,
    classes: "border-brand-border bg-brand-soft/60 text-brand-ink hover:bg-brand-soft",
  },
];

/**
 * `suggested` only draws a ring — pressing a button is what submits that
 * quality. The machine grade is submitted by the card's own "Next card"
 * button, so these four stay the override: a mark on the wrong side of a
 * threshold is a scheduling error the student would otherwise never notice.
 */
export function ReviewGradeButtons({
  onGrade,
  suggested = null,
  disabled = false,
}: {
  onGrade: (quality: number) => void;
  suggested?: number | null;
  disabled?: boolean;
}) {
  return (
    <div className="grid w-full max-w-md grid-cols-4 gap-2">
      {GRADES.map((g, i) => (
        <button
          key={g.label}
          onClick={() => onGrade(g.quality)}
          disabled={disabled}
          aria-keyshortcuts={String(i + 1)}
          className={`relative flex flex-col items-center rounded-xl border px-2 py-2.5 transition-colors disabled:opacity-50 ${g.classes} ${
            suggested === g.quality ? "ring-2 ring-brand ring-offset-1 ring-offset-surface" : ""
          }`}
        >
          <kbd className="absolute left-1.5 top-1 font-sans text-[10px] opacity-50" aria-hidden="true">
            {i + 1}
          </kbd>
          <span className="text-sm font-semibold">{g.label}</span>
          <span className="text-[11px] opacity-70">{g.sublabel}</span>
          {suggested === g.quality && <span className="text-[10px] opacity-70">suggested</span>}
        </button>
      ))}
    </div>
  );
}
