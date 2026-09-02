"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Presentation, ScrollText, Trash2 } from "lucide-react";
import { shortDate } from "@/lib/format";

export type MaterialSummary = {
  id: string;
  kind: string;
  title: string;
  sourceFileName: string | null;
  slideCount: number | null;
  createdAt: Date;
};

const ICONS: Record<string, typeof FileText> = {
  SYLLABUS: ScrollText,
  SLIDES: Presentation,
  READING: FileText,
  OTHER: FileText,
};

export function MaterialList({ materials }: { materials: MaterialSummary[] }) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    try {
      const res = await fetch(`/api/materials/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Could not delete that material.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setDeleting(null);
    }
  }

  if (materials.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-14 text-center text-sm text-zinc-400">
        No materials yet. Add the syllabus and the lecturer&apos;s slides so this course knows what it
        covers.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}
      <ul className="flex flex-col gap-2">
        {materials.map((material) => {
          const Icon = ICONS[material.kind] ?? FileText;
          return (
            <li
              key={material.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">{material.title}</p>
                <p className="truncate text-[12.5px] text-zinc-400">
                  {material.kind.toLowerCase()}
                  {material.slideCount !== null ? ` · ${material.slideCount} slides` : ""}
                  {material.sourceFileName ? ` · ${material.sourceFileName}` : ""}
                  {` · ${shortDate(material.createdAt)}`}
                </p>
              </div>
              <button
                onClick={() => remove(material.id)}
                disabled={deleting === material.id}
                aria-label={`Delete ${material.title}`}
                className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
