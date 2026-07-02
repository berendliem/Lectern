import { db } from "@/lib/db";
import { PageList } from "@/components/dashboard/PageList";
import { NewPageButton } from "@/components/dashboard/NewPageButton";
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">All pages</h1>
        <NewPageButton />
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
