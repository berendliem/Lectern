import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { db } from "@/lib/db";
import { courseScopeFilter } from "@/lib/cards";
import { QuizRunner, type QuizQuestionForRunner } from "@/components/quiz/QuizRunner";

export const dynamic = "force-dynamic";

// Fisher-Yates shuffle so each cram session mixes questions from across the
// whole folder rather than grouping them lecture by lecture.
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default async function ExamCramPage({ params }: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await params;
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) notFound();

  const questions = await db.quizQuestion.findMany({
    where: courseScopeFilter(folderId),
    select: { id: true, type: true, prompt: true, options: true },
  });

  const runnerQuestions: QuizQuestionForRunner[] = shuffle(questions).map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options ? (JSON.parse(q.options) as string[]) : null,
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link
        href={`/folders/${folder.id}`}
        className="flex items-center gap-1 self-start text-[13px] font-medium text-zinc-400 hover:text-brand"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        {folder.name}
      </Link>

      <div className="flex items-center gap-3 rounded-2xl border border-brand-border grad-brand-soft p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl grad-brand text-white shadow-brand">
          <GraduationCap className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-900">Exam cram · {folder.name}</h1>
          <p className="text-[13px] text-zinc-500">
            {runnerQuestions.length} question{runnerQuestions.length === 1 ? "" : "s"} mixed from this course&apos;s lectures and materials.
          </p>
        </div>
      </div>

      {runnerQuestions.length > 0 ? (
        <QuizRunner questions={runnerQuestions} />
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-14 text-center text-sm text-zinc-400">
          No quiz questions in this course yet. Generate a learning guide on a lecture first.
        </div>
      )}
    </div>
  );
}
