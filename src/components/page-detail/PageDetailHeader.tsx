"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PAGE_STATUS_LABEL, PAGE_STATUS_TONE } from "@/lib/page-status";
import type { PageStatus } from "@/generated/prisma/enums";

export function PageDetailHeader({
  pageId,
  title,
  status,
  folder,
}: {
  pageId: string;
  title: string;
  status: PageStatus;
  folder: { id: string; name: string } | null;
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
          <Link href={`/folders/${folder.id}`} className="text-xs font-medium text-slate-400 hover:text-indigo-600">
            {folder.name}
          </Link>
        )}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <Badge tone={PAGE_STATUS_TONE[status]}>{PAGE_STATUS_LABEL[status]}</Badge>
        </div>
      </div>
      <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
        Delete
      </Button>
    </div>
  );
}
