import Link from "next/link";
import { CalendarDays, Flame, GraduationCap, Layers } from "lucide-react";
import { db } from "@/lib/db";
import { computeStreak, upcomingSchedule } from "@/lib/planner";
import { RECALL_LEDGER_SINCE, calibration } from "@/lib/recall";
import clsx from "@/lib/clsx";
import { groupByDay, SYNC_WINDOW_DAYS } from "@/lib/calendar-events";
import { isCalendarConfigured } from "@/lib/calendar-sync";
import { folderFamily, FOLDER_CHIP_CLASSES } from "@/lib/folder-colors";

export const dynamic = "force-dynamic";

export default async function PlannerPage() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [logs, cards, dueNow, reviewedToday, totalCards, rated, events, calendarConfigured] = await Promise.all([
    // Deliberately unfiltered by date: this read counts events for the streak and
    // never scores them, so the pre-ledger rows still belong in it.
    db.reviewLog.findMany({ orderBy: { reviewedAt: "desc" }, take: 500, select: { reviewedAt: true } }),
    db.flashcard.findMany({ select: { nextReviewAt: true } }),
    db.flashcard.count({ where: { nextReviewAt: { lte: now } } }),
    db.reviewLog.count({ where: { reviewedAt: { gte: startOfToday } } }),
    db.flashcard.count(),
    // This read scores, so it starts at the ledger: a backfilled quality of 0 is
    // not a failed recall, and reading it as one would invent an overconfidence
    // the student never showed.
    db.reviewLog.findMany({
      where: { reviewedAt: { gte: RECALL_LEDGER_SINCE }, confidence: { not: null } },
      orderBy: { reviewedAt: "desc" },
      take: 200,
      select: { confidence: true, quality: true },
    }),
    db.calendarEvent.findMany({
      where: {
        start: {
          gte: startOfToday,
          lt: new Date(startOfToday.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { start: "asc" },
      include: { folder: { select: { id: true, name: true, color: true } } },
    }),
    isCalendarConfigured(),
  ]);

  const streak = computeStreak(logs.map((l) => l.reviewedAt), now);
  const schedule = upcomingSchedule(cards.map((c) => c.nextReviewAt), 7, now);
  const maxCount = Math.max(1, ...schedule.map((d) => d.count));
  const calibrated = calibration(rated);
  const percent = (share: number) => `${Math.round(share * 100)}%`;
  const eventGroups = groupByDay(events, now);
  const KIND_LABEL: Record<string, string> = { EXAM: "Exam", ASSIGNMENT: "Due", CLASS: "Class", OTHER: "" };

  const stats = [
    { label: "Due now", value: dueNow, icon: GraduationCap, tint: "bg-brand-soft text-brand-ink", href: dueNow > 0 ? "/review" : null },
    { label: "Reviewed today", value: reviewedToday, icon: CalendarDays, tint: "bg-moss-soft text-moss-ink", href: null },
    { label: "Total cards", value: totalCards, icon: Layers, tint: "bg-lavender-soft text-lavender-ink", href: null },
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Study planner</h1>
        <p className="mt-0.5 text-[13px] text-muted">Keep your streak alive and see what&apos;s coming due.</p>
      </div>

      {/* Streak hero */}
      <div className="flex items-center gap-4 rounded-2xl border border-brand-border bg-brand-soft p-5">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-brand">
          <Flame className="h-7 w-7" strokeWidth={2} />
        </span>
        <div>
          <p className="text-3xl font-bold leading-none text-ink">
            {streak} <span className="text-lg font-semibold text-muted">day{streak === 1 ? "" : "s"}</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {streak === 0
              ? "Review a card today to start a streak."
              : reviewedToday > 0
                ? "You've studied today — nice."
                : "Review a card today to keep it going."}
          </p>
        </div>
      </div>

      {/* Calibration: read-only, and only once there is something to read. */}
      {calibrated.rated > 0 && (
        <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-2">
            How well you know what you know
          </p>
          <p className="text-[13px] text-ink-soft">
            Certain and wrong on <span className="font-semibold">{percent(calibrated.overconfidentWrong)}</span>{" "}
            of the cards you were sure about; right anyway on{" "}
            <span className="font-semibold">{percent(calibrated.underconfidentRight)}</span> of the ones you were
            guessing at.
          </p>
          <p className="text-[12px] text-muted-2">
            Over your last {calibrated.rated} rated review{calibrated.rated === 1 ? "" : "s"}.
          </p>
        </div>
      )}

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
                <span className="block text-lg font-semibold leading-6 text-ink">{s.value}</span>
                <span className="block text-[12.5px] leading-4 text-muted">{s.label}</span>
              </span>
            </>
          );
          const cls = "flex items-center gap-3 rounded-xl border border-line/80 bg-surface p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]";
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
      <div className="rounded-2xl border border-line/80 bg-surface p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">Next 7 days</h2>
        <div className="flex flex-col gap-2.5">
          {schedule.map((d) => (
            <div key={d.key} className="flex items-center gap-3">
              <span className={clsx("w-16 shrink-0 text-[13px]", d.isToday ? "font-semibold text-brand-ink" : "text-muted")}>
                {d.label}
              </span>
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface-3">
                {d.count > 0 && (
                  <div
                    className="h-full rounded-md bg-brand"
                    style={{ width: `${Math.max(6, (d.count / maxCount) * 100)}%` }}
                  />
                )}
              </div>
              <span className="w-8 shrink-0 text-right text-[13px] tabular-nums text-muted">{d.count}</span>
            </div>
          ))}
        </div>
        {totalCards === 0 && (
          <p className="mt-4 text-[13px] text-muted-2">
            No flashcards yet — generate a learning guide on a lecture to start scheduling reviews.
          </p>
        )}
      </div>

      {/* Calendar: everything the sync pulled, not just the academic subset home shows. */}
      <div className="rounded-2xl border border-line/80 bg-surface p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">Calendar, next {SYNC_WINDOW_DAYS} days</h2>
        {!calendarConfigured ? (
          <p className="text-[13px] text-muted-2">
            <Link href="/integrations" className="font-semibold text-brand-ink hover:underline">
              Connect Google Calendar
            </Link>{" "}
            to see your classes, deadlines and exams here.
          </p>
        ) : eventGroups.length === 0 ? (
          <p className="text-[13px] text-muted-2">Nothing on the calendar in this window.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {eventGroups.map((g) => (
              <li key={g.key}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-2">{g.label}</p>
                <ul className="flex flex-col gap-1.5">
                  {g.events.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 text-[13px]">
                      <span className="w-12 shrink-0 tabular-nums text-muted">
                        {e.allDay
                          ? "All day"
                          : e.start.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false })}
                      </span>
                      {e.folder && (
                        <span
                          className={clsx(
                            "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                            FOLDER_CHIP_CLASSES[folderFamily(e.folder.color)]
                          )}
                        >
                          {e.folder.name}
                        </span>
                      )}
                      <span className="truncate text-ink">{e.title}</span>
                      {KIND_LABEL[e.kind] && (
                        <span className="ml-auto shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                          {KIND_LABEL[e.kind]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
