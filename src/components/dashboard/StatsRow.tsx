import Link from "next/link";

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
    { label: "Lecture pages", value: pageCount, href: null },
    { label: "Cards due for review", value: dueCount, href: dueCount > 0 ? "/review" : null },
    { label: "Flashcards", value: flashcardCount, href: null },
    { label: "Quiz questions", value: quizCount, href: null },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => {
        const inner = (
          <>
            <p className="text-sm text-slate-500">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{compact(tile.value)}</p>
          </>
        );
        return tile.href ? (
          <Link
            key={tile.label}
            href={tile.href}
            className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 transition-colors hover:bg-indigo-50"
          >
            {inner}
          </Link>
        ) : (
          <div key={tile.label} className="rounded-xl border border-slate-200 bg-white p-4">
            {inner}
          </div>
        );
      })}
    </div>
  );
}
