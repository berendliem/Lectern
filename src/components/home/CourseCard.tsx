import Link from "next/link";
import { MasteryRing } from "@/components/home/MasteryRing";
import { examCountdown, type FolderCardStats } from "@/lib/calendar-events";
import { folderFamily, FOLDER_DOT_CLASSES } from "@/lib/folder-colors";
import { shortDate } from "@/lib/format";
import clsx from "@/lib/clsx";

export type CourseCardData = {
  folder: { id: string; name: string; color: string | null };
  stats: FolderCardStats;
  nextExam: { title: string; start: Date } | null;
  lastLectureAt: Date | null;
  now: Date;
};

export function CourseCard({ folder, stats, nextExam, lastLectureAt, now }: CourseCardData) {
  const value = stats.total > 0 ? stats.mastered / stats.total : null;
  const family = folderFamily(folder.color);

  return (
    <Link
      href={`/folders/${folder.id}`}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-semibold leading-5 text-ink">
            <span className={clsx("h-2 w-2 shrink-0 rounded-full", FOLDER_DOT_CLASSES[family])} aria-hidden="true" />
            <span className="truncate">{folder.name}</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {stats.total === 0 ? "No cards yet" : stats.due > 0 ? `${stats.due} due` : "Nothing due"}
          </p>
        </div>
        <MasteryRing value={value} />
      </div>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        {nextExam ? (
          <span className="truncate text-ink-soft">
            {nextExam.title} · <span className="font-semibold text-gold">{examCountdown(nextExam.start, now)}</span>
          </span>
        ) : (
          <span className="text-muted-2">No exam scheduled</span>
        )}
        {lastLectureAt && <span className="shrink-0 text-muted-2">{shortDate(lastLectureAt)}</span>}
      </div>
    </Link>
  );
}
