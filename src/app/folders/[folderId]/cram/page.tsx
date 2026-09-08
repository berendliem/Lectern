import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { db } from "@/lib/db";
import { courseScopeFilter } from "@/lib/cards";
import { RECALL_LEDGER_SINCE, cramWeight, weightedSample, type CramStats } from "@/lib/recall";
import { QuizRunner, type QuizQuestionForRunner } from "@/components/quiz/QuizRunner";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

// Fisher-Yates shuffle so each cram session mixes questions from across the
// whole folder rather than grouping them lecture by lecture. It stays the
// cold-start path: with no recall events there is nothing to weight by.
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type SourceKey = string;

function sourceKey(row: { pageId: string | null; materialId: string | null }): SourceKey | null {
  if (row.pageId) return `p:${row.pageId}`;
  if (row.materialId) return `m:${row.materialId}`;
  return null;
}

/**
 * What the ledger knows about each lecture and material in this course.
 *
 * Per source, not per question: a quiz event records which lecture the question
 * came from, so "you keep failing this lecture" is the finest grain honestly
 * available — and it is the grain that decides what to study next anyway.
 */
async function recallBySource(folderId: string, now: Date): Promise<Map<SourceKey, CramStats>> {
  const events = await db.reviewLog.findMany({
    // A scored read, so it starts at the ledger: backfilled zeros would rank
    // every old lecture as freshly failed.
    where: {
      reviewedAt: { gte: RECALL_LEDGER_SINCE },
      OR: [{ page: { folderId } }, { material: { folderId } }],
    },
    orderBy: { reviewedAt: "desc" },
    select: {
      pageId: true,
      materialId: true,
      quality: true,
      reviewedAt: true,
      resolvedAt: true,
      misconception: true,
    },
  });

  const stats = new Map<SourceKey, CramStats>();
  for (const event of events) {
    const key = sourceKey(event);
    if (!key) continue;
    const open = event.misconception !== null && event.resolvedAt === null;
    const existing = stats.get(key);
    if (!existing) {
      // Events arrive newest first, so the first one seen is the recent one.
      stats.set(key, {
        recentQuality: event.quality,
        daysSinceLastSeen: (now.getTime() - event.reviewedAt.getTime()) / DAY_MS,
        openMisconception: open,
      });
    } else if (open) {
      existing.openMisconception = true;
    }
  }
  return stats;
}

export default async function ExamCramPage({ params }: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await params;
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) notFound();

  const now = new Date();
  const [questions, stats] = await Promise.all([
    db.quizQuestion.findMany({
      where: courseScopeFilter(folderId),
      select: { id: true, type: true, prompt: true, options: true, pageId: true, materialId: true },
    }),
    recallBySource(folderId, now),
  ]);

  // Weighted once the ledger has anything to say, shuffled until then. Either
  // way the draw is across the whole course and never sorted back into lecture
  // order: blocking by lecture is what the shuffle was there to prevent, and
  // weighting must not quietly reinstate it.
  const ordered =
    stats.size === 0
      ? shuffle(questions)
      : weightedSample(
          questions,
          questions.map((q) => {
            const seen = stats.get(sourceKey(q) ?? "");
            return cramWeight(
              seen ?? { recentQuality: null, daysSinceLastSeen: null, openMisconception: false }
            );
          }),
          questions.length
        );

  const runnerQuestions: QuizQuestionForRunner[] = ordered.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options ? (JSON.parse(q.options) as string[]) : null,
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link
        href={`/folders/${folder.id}`}
        className="flex items-center gap-1 self-start text-[13px] font-medium text-muted-2 hover:text-brand-ink"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        {folder.name}
      </Link>

      <div className="flex items-center gap-3 rounded-2xl border border-brand-border bg-brand-soft p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white shadow-brand">
          <GraduationCap className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-ink">Exam cram · {folder.name}</h1>
          <p className="text-[13px] text-muted">
            {runnerQuestions.length} question{runnerQuestions.length === 1 ? "" : "s"} mixed from this course&apos;s lectures and materials{stats.size > 0 ? ", weakest and stalest first" : ""}.
          </p>
        </div>
      </div>

      {runnerQuestions.length > 0 ? (
        <QuizRunner questions={runnerQuestions} />
      ) : (
        <div className="rounded-2xl border border-dashed border-line-strong px-4 py-14 text-center text-sm text-muted-2">
          No quiz questions in this course yet. Generate a learning guide on a lecture, or a quiz
          on a material, first.
        </div>
      )}
    </div>
  );
}
