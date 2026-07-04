import Link from "next/link";
import { CalendarDays, Flame, GraduationCap, Layers } from "lucide-react";
import { db } from "@/lib/db";
import { computeStreak, upcomingSchedule } from "@/lib/planner";
import clsx from "@/lib/clsx";

export const dynamic = "force-dynamic";

export default async function PlannerPage() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [logs, cards, dueNow, reviewedToday, totalCards] = await Promise.all([
    db.reviewLog.findMany({ orderBy: { reviewedAt: "desc" }, take: 500, select: { reviewedAt: true } }),
    db.flashcard.findMany({ select: { nextReviewAt: true } }),
    db.flashcard.count({ where: { nextReviewAt: { lte: now } } }),
    db.reviewLog.count({ where: { reviewedAt: { gte: startOfToday } } }),
    db.flashcard.count(),
  ]);

  const streak = computeStreak(logs.map((l) => l.reviewedAt), now);
  const schedule = upcomingSchedule(cards.map((c) => c.nextReviewAt), 7, now);
  const maxCount = Math.max(1, ...schedule.map((d) => d.count));

  const stats = [
    { label: "Due now", value: dueNow, icon: GraduationCap, tint: "bg-brand-soft text-brand", href: dueNow > 0 ? "/review" : null },
    { label: "Reviewed today", value: reviewedToday, icon: CalendarDays, tint: "bg-moss-soft text-moss-ink", href: null },
    { label: "Total cards", value: totalCards, icon: Layers, tint: "bg-lavender-soft text-lavender-ink", href: null },
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gradient">Study planner</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">Keep your streak alive and see what&apos;s coming due.</p>
      </div>

      {/* Streak hero */}
      <div className="flex items-center gap-4 rounded-2xl border border-brand-border grad-brand-soft p-5">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl grad-brand text-white shadow-brand">
          <Flame className="h-7 w-7" strokeWidth={2} />
        </span>
        <div>
          <p className="text-3xl font-bold leading-none text-zinc-900">
            {streak} <span className="text-lg font-semibold text-zinc-500">day{streak === 1 ? "" : "s"}</span>
          </p>
          <p className="mt-1 text-[13px] text-zinc-500">
            {streak === 0
              ? "Review a card today to start a streak."
              : reviewedToday > 0
                ? "You've studied today — nice."
                : "Review a card today to keep it going."}
          </p>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          const inner = (
            <>
              <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", s.tint)}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <span>
                <span className="block text-lg font-semibold leading-6 text-zinc-900">{s.value}</span>
                <span className="block text-[12.5px] leading-4 text-zinc-500">{s.label}</span>
              </span>
            </>
          );
          const cls = "flex items-center gap-3 rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]";
          return s.href ? (
            <Link key={s.label} href={s.href} className={clsx(cls, "transition-colors hover:border-brand-border hover:bg-brand-soft/40")}>
              {inner}
            </Link>
          ) : (
            <div key={s.label} className={cls}>
              {inner}
            </div>
          );
        })}
      </div>

      {/* Upcoming 7-day schedule */}
      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900">Next 7 days</h2>
        <div className="flex flex-col gap-2.5">
          {schedule.map((d) => (
            <div key={d.key} className="flex items-center gap-3">
              <span className={clsx("w-16 shrink-0 text-[13px]", d.isToday ? "font-semibold text-brand" : "text-zinc-500")}>
                {d.label}
              </span>
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-zinc-100">
                {d.count > 0 && (
                  <div
                    className="h-full rounded-md grad-brand"
                    style={{ width: `${Math.max(6, (d.count / maxCount) * 100)}%` }}
                  />
                )}
              </div>
              <span className="w-8 shrink-0 text-right text-[13px] tabular-nums text-zinc-500">{d.count}</span>
            </div>
          ))}
        </div>
        {totalCards === 0 && (
          <p className="mt-4 text-[13px] text-zinc-400">
            No flashcards yet — generate a learning guide on a lecture to start scheduling reviews.
          </p>
        )}
      </div>
    </div>
  );
}
