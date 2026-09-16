"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
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
  flashcardCount,
  quizCount,
}: {
  pageId: string;
  title: string;
  status: PageStatus;
  folder: { id: string; name: string } | null;
  tags: { id: string; name: string }[];
  flashcardCount: number;
  quizCount: number;
}) {
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [next, setNext] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function openRename() {
    setNext(title);
    setError(null);
    setRenaming(true);
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = next.trim();
    if (!trimmed || saving) return;
    if (trimmed === title) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        setError("Could not rename the lecture.");
        return;
      }
      setRenaming(false);
      router.refresh();
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    // The cascade takes the cards and questions, and with them the intervals
    // and ease the student has built up. The recall ledger is SetNull and
    // survives, so the streak does not lie — but the scheduling is gone.
    const alsoGone = [
      flashcardCount > 0 ? `${flashcardCount} flashcard${flashcardCount === 1 ? "" : "s"}` : null,
      quizCount > 0 ? `${quizCount} quiz question${quizCount === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    const tail =
      alsoGone.length > 0
        ? ` This also permanently deletes its ${alsoGone.join(" and ")}, along with the review progress on them.`
        : "";
    if (!confirm(`Delete "${title}"? This removes its audio, transcript, and notes.${tail}`)) return;
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
          <Link href={`/folders/${folder.id}`} className="text-xs font-medium text-muted-2 hover:text-brand-ink">
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
        <Button variant="ghost" size="sm" onClick={openRename} aria-label="Rename lecture">
          <Pencil className="h-4 w-4 text-muted-2" strokeWidth={2} />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleting} aria-label="Delete page">
          <Trash2 className="h-4 w-4 text-muted-2" strokeWidth={2} />
        </Button>
      </div>
      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename lecture">
        <form onSubmit={handleRename} className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Lecture title"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !next.trim()}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
