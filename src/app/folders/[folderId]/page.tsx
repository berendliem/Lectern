import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { db } from "@/lib/db";
import { PageList } from "@/components/dashboard/PageList";
import { NewPageButton } from "@/components/dashboard/NewPageButton";
import { FolderHeader } from "@/components/dashboard/FolderHeader";

export const dynamic = "force-dynamic";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) notFound();

  const [pages, quizCount] = await Promise.all([
    db.page.findMany({
      where: { folderId },
      orderBy: { updatedAt: "desc" },
      include: {
        folder: true,
        tags: { include: { tag: true } },
        _count: { select: { flashcards: true, quizQuestions: true } },
      },
    }),
    db.quizQuestion.count({ where: { page: { folderId } } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-gradient">{folder.name}</h1>
        <div className="flex items-center gap-2">
          {quizCount > 0 && (
            <Link
              href={`/folders/${folder.id}/cram`}
              className="inline-flex items-center gap-1.5 rounded-lg grad-brand px-3 py-2 text-sm font-medium text-white shadow-brand transition-opacity hover:opacity-95"
            >
              <GraduationCap className="h-4 w-4" strokeWidth={2} />
              Exam cram
            </Link>
          )}
          <NewPageButton folderId={folder.id} />
          <FolderHeader folderId={folder.id} name={folder.name} />
        </div>
      </div>
      <PageList pages={pages} />
    </div>
  );
}
