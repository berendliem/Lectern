import { notFound } from "next/navigation";
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

  const pages = await db.page.findMany({
    where: { folderId },
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
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{folder.name}</h1>
        <div className="flex items-center gap-2">
          <NewPageButton folderId={folder.id} />
          <FolderHeader folderId={folder.id} name={folder.name} />
        </div>
      </div>
      <PageList pages={pages} />
    </div>
  );
}
