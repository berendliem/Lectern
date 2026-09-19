import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { InterviewRunner } from "@/components/interview/InterviewRunner";
import { GoLiveButton } from "@/components/interview/GoLiveButton";
import { LiveSession } from "@/components/interview/live/LiveSession";
import { MAX_INTERVIEW_QUESTIONS } from "@/lib/interview";

export const dynamic = "force-dynamic";

export default async function InterviewSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      topic: { select: { title: true } },
    },
  });
  if (!session) notFound();

  const active = session.status === "ACTIVE";
  // The turn waiting on the student: unanswered, or answered but never replied to.
  const open = session.turns.find((t) => t.speaker === null && t.feedback === null);

  let body: React.ReactNode;
  if (session.live && active && session.mode !== "DEBATE") {
    body = (
      <LiveSession
        sessionId={session.id}
        mode={session.mode === "PROTEGE" ? "PROTEGE" : "VIVA"}
        openTurn={open ? { id: open.id, order: open.order, question: open.question, retryOf: open.retryOf } : null}
      />
    );
  } else {
    body = (
      <>
        {active && <GoLiveButton sessionId={session.id} />}
        <InterviewRunner
          sessionId={session.id}
          title={session.title}
          concept={session.topic?.title ?? session.title}
          mode={session.mode}
          status={session.status}
          initialTurns={session.turns.map((t) => ({
            id: t.id,
            order: t.order,
            speaker: t.speaker,
            question: t.question,
            answer: t.answer,
            feedback: t.feedback,
          }))}
          totalQuestions={MAX_INTERVIEW_QUESTIONS}
        />
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link href="/interview" className="flex items-center gap-1 self-start text-[13px] font-medium text-muted-2 hover:text-brand-ink">
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        All interviews
      </Link>
      {session.live && <h1 className="text-xl font-semibold text-ink">{session.title}</h1>}
      {body}
    </div>
  );
}
