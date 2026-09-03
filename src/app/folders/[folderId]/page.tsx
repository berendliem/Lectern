import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { db } from "@/lib/db";
import { courseScopeFilter } from "@/lib/cards";
import { PageList } from "@/components/dashboard/PageList";
import { NewPageButton } from "@/components/dashboard/NewPageButton";
import { ImportButton } from "@/components/dashboard/ImportButton";
import { TranscriptImportButton } from "@/components/dashboard/TranscriptImportButton";
import { FolderHeader } from "@/components/dashboard/FolderHeader";
import { PageTabs } from "@/components/page-detail/PageTabs";
import { MaterialUploadButton } from "@/components/dashboard/MaterialUploadButton";
import { MaterialList } from "@/components/dashboard/MaterialList";
import { CourseChat } from "@/components/ask/CourseChat";

export const dynamic = "force-dynamic";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) notFound();

  const [pages, quizCount, materials] = await Promise.all([
    db.page.findMany({
      where: { folderId },
      orderBy: { updatedAt: "desc" },
      include: {
        folder: true,
        tags: { include: { tag: true } },
        _count: { select: { flashcards: true, quizQuestions: true } },
      },
    }),
    db.quizQuestion.count({ where: courseScopeFilter(folderId) }),
    db.material.findMany({
      where: { folderId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        title: true,
        sourceFileName: true,
        slideCount: true,
        createdAt: true,
        _count: { select: { flashcards: true, quizQuestions: true } },
      },
    }),
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

      <PageTabs
        tabs={[
          {
            id: "lectures",
            label: `Lectures (${pages.length})`,
            content: (
              <div className="flex flex-col gap-4">
                <div className="flex justify-end gap-2">
                  <TranscriptImportButton folderId={folder.id} />
                  <ImportButton folderId={folder.id} />
                </div>
                <PageList pages={pages} />
              </div>
            ),
          },
          {
            id: "materials",
            label: `Materials (${materials.length})`,
            content: (
              <div className="flex flex-col gap-4">
                <div className="flex justify-end">
                  <MaterialUploadButton folderId={folder.id} />
                </div>
                <MaterialList
                  materials={materials.map((m) => ({
                    id: m.id,
                    kind: m.kind,
                    title: m.title,
                    sourceFileName: m.sourceFileName,
                    slideCount: m.slideCount,
                    createdAt: m.createdAt,
                    flashcardCount: m._count.flashcards,
                    quizCount: m._count.quizQuestions,
                  }))}
                />
              </div>
            ),
          },
          {
            id: "ask",
            label: "Ask",
            content: <CourseChat folderId={folder.id} />,
          },
        ]}
      />
    </div>
  );
}
