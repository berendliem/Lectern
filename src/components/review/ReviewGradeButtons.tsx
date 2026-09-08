const GRADES: { label: string; sublabel: string; quality: number; classes: string }[] = [
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
 * `suggested` only draws a ring. It never submits: a nudge on the wrong side of
 * a threshold is a scheduling error the student would never notice, so the
 * grade stays theirs to press.
 */
export function ReviewGradeButtons({
  onGrade,
  suggested = null,
}: {
  onGrade: (quality: number) => void;
  suggested?: number | null;
}) {
  return (
    <div className="grid w-full max-w-md grid-cols-4 gap-2">
      {GRADES.map((g) => (
        <button
          key={g.label}
          onClick={() => onGrade(g.quality)}
          className={`flex flex-col items-center rounded-xl border px-2 py-2.5 transition-colors ${g.classes} ${
            suggested === g.quality ? "ring-2 ring-brand ring-offset-1 ring-offset-surface" : ""
          }`}
        >
          <span className="text-sm font-semibold">{g.label}</span>
          <span className="text-[11px] opacity-70">{g.sublabel}</span>
          {suggested === g.quality && <span className="text-[10px] opacity-70">suggested</span>}
        </button>
      ))}
    </div>
  );
}
