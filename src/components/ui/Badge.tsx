import clsx from "@/lib/clsx";

type Tone = "neutral" | "blue" | "green" | "amber" | "red";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-soft",
  blue: "bg-lavender-soft text-lavender-ink",
  green: "bg-moss-soft text-moss-ink",
  amber: "bg-daisy-soft text-daisy-ink",
  red: "bg-blush-soft text-blush-ink",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
