import { db } from "@/lib/db";
import { PageList } from "@/components/dashboard/PageList";
import { NewPageButton } from "@/components/dashboard/NewPageButton";
import { ImportButton } from "@/components/dashboard/ImportButton";
import { StatsRow } from "@/components/dashboard/StatsRow";

// This page reads directly from the local SQLite DB via Prisma, which Next
// can't see as a "dynamic" data source -- without this it gets frozen as
// static HTML at build time and never reflects new pages under `next start`.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [pages, dueCount, flashcardCount, quizCount] = await Promise.all([
    db.page.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        folder: true,
        tags: { include: { tag: true } },
        _count: { select: { flashcards: true, quizQuestions: true } },
      },
    }),
    db.flashcard.count({ where: { nextReviewAt: { lte: new Date() } } }),
    db.flashcard.count(),
    db.quizQuestion.count(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Courses</h1>
          <p className="mt-0.5 text-[13px] text-muted">Every lecture you&apos;ve captured, filed by course.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportButton />
          <NewPageButton />
        </div>
      </div>
      <StatsRow
        pageCount={pages.length}
        dueCount={dueCount}
        flashcardCount={flashcardCount}
        quizCount={quizCount}
      />
      <PageList pages={pages} />
    </div>
  );
}
