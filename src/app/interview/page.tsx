import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";
import { InterviewStartForm } from "@/components/interview/InterviewStartForm";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// Syllabus topics handed to the interviewer as the subject. More than this
// stops being a subject and starts being the whole course.
const MAX_TOPICS = 12;

export default async function InterviewHubPage({
  searchParams,
}: {
  searchParams: Promise<{ folderId?: string }>;
}) {
  const { folderId } = await searchParams;
  const [sessions, course] = await Promise.all([
    db.interviewSession.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { turns: true } } },
    }),
    folderId
      ? db.folder.findUnique({
          where: { id: folderId },
          select: { name: true, topics: { orderBy: { order: "asc" }, select: { title: true } } },
        })
      : null,
  ]);

  const topics = course?.topics.slice(0, MAX_TOPICS).map((t) => t.title) ?? [];
  const initialTopic = course
    ? topics.length > 0
      ? `Grill me on the course "${course.name}", covering: ${topics.join("; ")}.`
      : `Grill me on the course "${course.name}".`
    : "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Interview</h1>
        <p className="mt-0.5 text-[13px] text-muted-2">
          Practice out loud with an AI interviewer that adapts to your answers and coaches you.
        </p>
      </div>

      <InterviewStartForm
        initialTopic={initialTopic}
        initialTitle={course ? `${course.name} interview` : ""}
      />

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-2">Past interviews</h2>
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-lavender-soft text-lavender-ink">
              <MessagesSquare className="h-5 w-5" strokeWidth={2} />
            </span>
            <p className="text-[13px] text-muted-2">
              No interviews yet. Start one above, or from any lecture&apos;s page.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/interview/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line/80 bg-surface p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lavender-soft text-lavender-ink">
                      <MessagesSquare className="h-[18px] w-[18px]" strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{s.title}</p>
                      <p className="text-xs text-muted-2">
                        {s._count.turns} question{s._count.turns === 1 ? "" : "s"} · {shortDate(s.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Badge tone={s.status === "COMPLETED" ? "green" : "amber"}>
                    {s.status === "COMPLETED" ? "Completed" : "In progress"}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
