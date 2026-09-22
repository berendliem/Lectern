import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { WalkthroughRunner } from "@/components/walkthrough/WalkthroughRunner";

export const dynamic = "force-dynamic";

export default async function LearnMaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const material = await db.material.findUnique({
    where: { id },
    include: {
      folder: { select: { id: true, name: true } },
      walkthrough: { include: { steps: { orderBy: { ordinal: "asc" } } } },
    },
  });
  // The walkthrough is created by the button that links here, so arriving
  // without one means a stale link or a deleted material either way.
  if (!material || !material.walkthrough || material.walkthrough.steps.length === 0) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <Link
          href={`/folders/${material.folderId}`}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          {material.folder.name}
        </Link>
        <h1 className="text-xl font-semibold text-ink">{material.title}</h1>
      </div>

      <WalkthroughRunner
        materialId={material.id}
        folderId={material.folderId}
        startIndex={material.walkthrough.stepIndex}
        steps={material.walkthrough.steps.map((step) => ({
          id: step.id,
          ordinal: step.ordinal,
          label: step.label,
          sourceText: step.sourceText,
          explanation: step.explanation,
          recallPrompt: step.recallPrompt,
        }))}
      />
    </main>
  );
}
