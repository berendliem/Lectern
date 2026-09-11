import { db } from "@/lib/db";
import { NewPageButton } from "@/components/dashboard/NewPageButton";
import { ImportButton } from "@/components/dashboard/ImportButton";
import { TodayRow } from "@/components/home/TodayRow";
import { CourseCard } from "@/components/home/CourseCard";
import { computeStreak } from "@/lib/planner";
import { HOME_WINDOW_DAYS, isStale, masteryByFolder } from "@/lib/calendar-events";
import { UpNext, type UpNextEvent } from "@/components/home/UpNext";
import { CalendarSyncTrigger } from "@/components/home/CalendarSyncTrigger";
import { isCalendarConfigured } from "@/lib/calendar-sync";

// This page reads directly from the local SQLite DB via Prisma, which Next
// can't see as a "dynamic" data source -- without this it gets frozen as
// static HTML at build time and never reflects new pages under `next start`.
export const dynamic = "force-dynamic";

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const now = new Date();

  const [folders, cards, logs, dueCount, exams, upcoming, lastSync, calendarConfigured] = await Promise.all([
    db.folder.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        color: true,
        pages: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
      },
    }),
    db.flashcard.findMany({
      select: {
        repetitions: true,
        lastReviewedAt: true,
        nextReviewAt: true,
        page: { select: { folderId: true } },
        material: { select: { folderId: true } },
      },
    }),
    // Counts events for the streak and never scores them, so pre-ledger rows belong in it.
    db.reviewLog.findMany({ orderBy: { reviewedAt: "desc" }, take: 500, select: { reviewedAt: true } }),
    db.flashcard.count({ where: { nextReviewAt: { lte: now } } }),
    db.calendarEvent.findMany({
      where: { kind: "EXAM", start: { gte: now }, folderId: { not: null } },
      orderBy: { start: "asc" },
      select: { folderId: true, title: true, start: true },
    }),
    db.calendarEvent.findMany({
      where: {
        start: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          lt: new Date(now.getTime() + HOME_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        },
        OR: [{ kind: { not: "OTHER" } }, { folderId: { not: null } }],
      },
      orderBy: { start: "asc" },
      take: 6,
      include: { folder: { select: { id: true, name: true, color: true } } },
    }),
    db.calendarEvent.aggregate({ _max: { syncedAt: true } }),
    isCalendarConfigured(),
  ]);

  const stats = masteryByFolder(
    cards.map((c) => ({
      repetitions: c.repetitions,
      lastReviewedAt: c.lastReviewedAt,
      nextReviewAt: c.nextReviewAt,
      folderId: c.page?.folderId ?? c.material?.folderId ?? null,
    })),
    now
  );
  const streak = computeStreak(logs.map((l) => l.reviewedAt), now);
  const nextExamByFolder = new Map<string, { title: string; start: Date }>();
  for (const e of exams) {
    if (e.folderId && !nextExamByFolder.has(e.folderId)) {
      nextExamByFolder.set(e.folderId, { title: e.title, start: e.start });
    }
  }

  const upNextEvents: UpNextEvent[] = upcoming.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start.toISOString(),
    allDay: e.allDay,
    kind: e.kind,
    folder: e.folder,
  }));
  const lastSyncedAt = lastSync._max.syncedAt;
  const stale = calendarConfigured && isStale(lastSyncedAt, now);

  const dateLine = now.toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-2">{dateLine}</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-8 tracking-tight text-ink">{greeting(now)}</h1>
        </div>
        <div className="flex items-center gap-2">
          <ImportButton />
          <NewPageButton />
        </div>
      </header>

      {folders.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-16 text-center">
          <p className="text-[15px] font-semibold text-ink">Create your first course</p>
          <p className="max-w-xs text-[13px] leading-5 text-muted-2">
            Courses hold lectures, materials, and the flashcards made from them. Use the plus beside “Your courses” in the sidebar.
          </p>
        </section>
      ) : (
        <>
          <TodayRow dueCount={dueCount} streak={streak} totalCards={cards.length} />

          <UpNext
            events={upNextEvents}
            folders={folders.map((f) => ({ id: f.id, name: f.name }))}
            configured={calendarConfigured}
            lastSyncedAt={lastSyncedAt ? lastSyncedAt.toISOString() : null}
            now={now.toISOString()}
          />
          <CalendarSyncTrigger stale={stale} />

          <section aria-labelledby="courses-heading" className="flex flex-col gap-3">
            <h2 id="courses-heading" className="text-[13px] font-semibold text-ink-soft">
              Courses
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {folders.map((f) => (
                <CourseCard
                  key={f.id}
                  folder={{ id: f.id, name: f.name, color: f.color }}
                  stats={stats.get(f.id) ?? { total: 0, mastered: 0, due: 0 }}
                  nextExam={nextExamByFolder.get(f.id) ?? null}
                  lastLectureAt={f.pages[0]?.updatedAt ?? null}
                  now={now}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
