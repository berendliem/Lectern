import Link from "next/link";
import { FileAudio, HelpCircle, Layers } from "lucide-react";
import type { PageStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/Badge";
import { PAGE_STATUS_LABEL, PAGE_STATUS_TONE } from "@/lib/page-status";
import { folderFamily, FOLDER_CHIP_CLASSES } from "@/lib/folder-colors";
import { shortDate } from "@/lib/format";
import clsx from "@/lib/clsx";

export type PageCardData = {
  id: string;
  title: string;
  status: PageStatus;
  updatedAt: string | Date;
  folder: { id: string; name: string; color: string | null } | null;
  tags: { tag: { id: string; name: string } }[];
  _count: { flashcards: number; quizQuestions: number };
};

export function PageCard({ page }: { page: PageCardData }) {
  const family = folderFamily(page.folder?.color);

  return (
    <Link
      href={`/pages/${page.id}`}
      className="group flex flex-col rounded-xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            page.folder ? FOLDER_CHIP_CLASSES[family] : "bg-zinc-100 text-zinc-500"
          )}
        >
          <FileAudio className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[14.5px] font-semibold leading-5 text-zinc-900 group-hover:text-black">
            {page.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-zinc-400">
            {page.folder ? page.folder.name : "No folder"} · {shortDate(page.updatedAt)}
          </p>
        </div>
      </div>

      {page.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {page.tags.map(({ tag }) => (
            <Badge key={tag.id} tone="blue">
              #{tag.name}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3">
        <span className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" strokeWidth={2} />
            {page._count.flashcards}
          </span>
          <span className="flex items-center gap-1">
            <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
            {page._count.quizQuestions}
          </span>
        </span>
        <Badge tone={PAGE_STATUS_TONE[page.status]}>{PAGE_STATUS_LABEL[page.status]}</Badge>
      </div>
    </Link>
  );
}
