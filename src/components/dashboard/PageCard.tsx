import Link from "next/link";
import type { PageStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/Badge";
import { PAGE_STATUS_LABEL, PAGE_STATUS_TONE } from "@/lib/page-status";

export type PageCardData = {
  id: string;
  title: string;
  status: PageStatus;
  updatedAt: string | Date;
  folder: { id: string; name: string } | null;
  tags: { tag: { id: string; name: string } }[];
  _count: { flashcards: number; quizQuestions: number };
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function PageCard({ page }: { page: PageCardData }) {
  return (
    <Link
      href={`/pages/${page.id}`}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 font-medium text-slate-900">{page.title}</h3>
        <Badge tone={PAGE_STATUS_TONE[page.status]} className="shrink-0">
          {PAGE_STATUS_LABEL[page.status]}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        {page.folder && <Badge tone="neutral">{page.folder.name}</Badge>}
        {page.tags.map(({ tag }) => (
          <Badge key={tag.id} tone="blue">
            #{tag.name}
          </Badge>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between text-xs text-slate-400">
        <span>
          {plural(page._count.flashcards, "card")} · {plural(page._count.quizQuestions, "question")}
        </span>
        <span>{new Date(page.updatedAt).toLocaleDateString()}</span>
      </div>
    </Link>
  );
}
