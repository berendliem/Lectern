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
    classes: "border-brand-border bg-brand-soft/60 text-brand hover:bg-brand-soft",
  },
];

export function ReviewGradeButtons({ onGrade }: { onGrade: (quality: number) => void }) {
  return (
    <div className="grid w-full max-w-md grid-cols-4 gap-2">
      {GRADES.map((g) => (
        <button
          key={g.label}
          onClick={() => onGrade(g.quality)}
          className={`flex flex-col items-center rounded-xl border px-2 py-2.5 transition-colors ${g.classes}`}
        >
          <span className="text-sm font-semibold">{g.label}</span>
          <span className="text-[11px] opacity-70">{g.sublabel}</span>
        </button>
      ))}
    </div>
  );
}
