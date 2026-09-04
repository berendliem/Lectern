"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { TagEditor } from "@/components/page-detail/TagEditor";
import { ExportMenu } from "@/components/export/ExportMenu";
import { PAGE_STATUS_LABEL, PAGE_STATUS_TONE } from "@/lib/page-status";
import type { PageStatus } from "@/generated/prisma/enums";

export function PageDetailHeader({
  pageId,
  title,
  status,
  folder,
  tags,
}: {
  pageId: string;
  title: string;
  status: PageStatus;
  folder: { id: string; name: string } | null;
  tags: { id: string; name: string }[];
}) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm(`Delete "${title}"? This removes its audio, transcript, notes, and flashcards.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/pages/${pageId}`, { method: "DELETE" });
    if (res.ok) {
      router.push(folder ? `/folders/${folder.id}` : "/");
      router.refresh();
    } else {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        {folder && (
          <Link href={`/folders/${folder.id}`} className="text-xs font-medium text-muted-2 hover:text-brand">
            {folder.name}
          </Link>
        )}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          <Badge tone={PAGE_STATUS_TONE[status]}>{PAGE_STATUS_LABEL[status]}</Badge>
        </div>
        <div className="mt-2">
          <TagEditor pageId={pageId} initialTags={tags} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ExportMenu pageId={pageId} />
        <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleting} aria-label="Delete page">
          <Trash2 className="h-4 w-4 text-muted-2" strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}
