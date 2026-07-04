import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";
import { InterviewStartForm } from "@/components/interview/InterviewStartForm";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InterviewHubPage() {
  const sessions = await db.interviewSession.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { turns: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Interview</h1>
        <p className="mt-0.5 text-[13px] text-zinc-400">
          Practice out loud with an AI interviewer that adapts to your answers and coaches you.
        </p>
      </div>

      <InterviewStartForm />

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Past interviews</h2>
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-lavender-soft text-lavender-ink">
              <MessagesSquare className="h-5 w-5" strokeWidth={2} />
            </span>
            <p className="text-[13px] text-zinc-400">
              No interviews yet. Start one above, or from any lecture&apos;s page.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/interview/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-white p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lavender-soft text-lavender-ink">
                      <MessagesSquare className="h-[18px] w-[18px]" strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{s.title}</p>
                      <p className="text-xs text-zinc-400">
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
