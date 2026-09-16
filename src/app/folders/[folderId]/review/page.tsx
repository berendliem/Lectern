import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCheck } from "lucide-react";
import { db } from "@/lib/db";
import { courseScopeFilter } from "@/lib/cards";
import { ReviewSession } from "@/components/review/ReviewSession";

export const dynamic = "force-dynamic";

export default async function CourseReviewPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) notFound();

  const dueCount = await db.flashcard.count({
    where: { nextReviewAt: { lte: new Date() }, ...courseScopeFilter(folderId) },
  });

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
          <CheckCheck className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-ink">
            Review · {folder.name}
          </h1>
          <p className="text-[13px] text-muted">
            {dueCount} card{dueCount === 1 ? "" : "s"} due from this course&apos;s lectures and
            materials.
          </p>
        </div>
      </div>

      <ReviewSession key={folder.id} folderId={folder.id} />
    </div>
  );
}
