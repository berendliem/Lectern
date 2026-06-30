import { db } from "@/lib/db";
import { PageList } from "@/components/dashboard/PageList";
import { NewPageButton } from "@/components/dashboard/NewPageButton";

export default async function DashboardPage() {
  const pages = await db.page.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      folder: true,
      tags: { include: { tag: true } },
      _count: { select: { flashcards: true, quizQuestions: true } },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">All pages</h1>
        <NewPageButton />
      </div>
      <PageList pages={pages} />
    </div>
  );
}
