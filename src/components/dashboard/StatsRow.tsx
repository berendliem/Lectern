import Link from "next/link";
import { FileAudio, GraduationCap, Layers, ListChecks } from "lucide-react";
import clsx from "@/lib/clsx";

function compact(n: number): string {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function StatsRow({
  pageCount,
  dueCount,
  flashcardCount,
  quizCount,
}: {
  pageCount: number;
  dueCount: number;
  flashcardCount: number;
  quizCount: number;
}) {
  const tiles = [
    {
      label: "Lectures",
      value: pageCount,
      icon: FileAudio,
      iconClasses: "bg-lavender-soft text-lavender-ink",
      href: null as string | null,
    },
    {
      label: "Due for review",
      value: dueCount,
      icon: GraduationCap,
      iconClasses: "bg-brand-soft text-brand",
      href: dueCount > 0 ? "/review" : null,
    },
    {
      label: "Flashcards",
      value: flashcardCount,
      icon: Layers,
      iconClasses: "bg-moss-soft text-moss-ink",
      href: null as string | null,
    },
    {
      label: "Quiz questions",
      value: quizCount,
      icon: ListChecks,
      iconClasses: "bg-daisy-soft text-daisy-ink",
      href: null as string | null,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        const inner = (
          <>
            <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tile.iconClasses)}>
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-semibold leading-6 text-ink">{compact(tile.value)}</span>
              <span className="block truncate text-[12.5px] leading-4 text-muted">{tile.label}</span>
            </span>
          </>
        );
        const classes =
          "flex items-center gap-3 rounded-xl border border-line/80 bg-surface p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]";
        return tile.href ? (
          <Link
            key={tile.label}
            href={tile.href}
            className={clsx(classes, "transition-colors hover:border-brand-border hover:bg-brand-soft/40")}
          >
            {inner}
          </Link>
        ) : (
          <div key={tile.label} className={classes}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
