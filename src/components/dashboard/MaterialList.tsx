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
  flashcardCount: number;
  quizCount: number;
};

const ICONS: Record<string, typeof FileText> = {
  SYLLABUS: ScrollText,
  SLIDES: Presentation,
  READING: FileText,
  OTHER: FileText,
};

export function MaterialList({ materials }: { materials: MaterialSummary[] }) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Extracted text keyed by material id. A material's body can run to megabytes,
  // so it is never part of the list payload and is fetched once, on first open.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const router = useRouter();

  async function togglePreview(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (previews[id] !== undefined) return;
    setLoadingPreview(id);
    setError(null);
    try {
      const res = await fetch(`/api/materials/${id}`);
      if (!res.ok) {
        setError("Could not load that material's text.");
        setOpenId(null);
        return;
      }
      const body = await res.json();
      setPreviews((prev) => ({ ...prev, [id]: body.material.text }));
    } catch {
      setError("Network error talking to the local server.");
      setOpenId(null);
    } finally {
      setLoadingPreview(null);
    }
  }

  async function generate(id: string, kind: "flashcards" | "quiz", existing: number) {
    // The generate routes delete what is already there before writing. For a
    // material with cards that means the scheduling those cards carry —
    // intervals, ease, the review history behind them — goes with them, and
    // the button that does it is labelled with the count, one click away.
    if (
      existing > 0 &&
      !confirm(
        kind === "flashcards"
          ? `Regenerate flashcards for this material? Its ${existing} existing card${existing === 1 ? "" : "s"} will be replaced, and the review progress on them (intervals and ease) is lost.`
          : `Regenerate the quiz for this material? Its ${existing} existing question${existing === 1 ? "" : "s"} will be replaced, along with your recorded attempts at them.`
      )
    ) {
      return;
    }

    setGenerating(`${id}:${kind}`);
    setError(null);
    try {
      const res = await fetch(`/api/materials/${id}/generate-${kind}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Could not generate ${kind} from that material.`);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setGenerating(null);
    }
  }

  async function remove(id: string, title: string, cards: number, questions: number) {
    // Cascade: the material's flashcards, quiz questions and search chunks go
    // with it. Every other delete in the app says what it takes; this one used
    // to take it silently.
    const alsoGone = [
      cards > 0 ? `${cards} flashcard${cards === 1 ? "" : "s"}` : null,
      questions > 0 ? `${questions} quiz question${questions === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    const tail =
      alsoGone.length > 0
        ? ` This also permanently deletes its ${alsoGone.join(" and ")}.`
        : "";
    if (!confirm(`Delete "${title}"?${tail}`)) return;

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
      <div className="rounded-2xl border border-dashed border-line-strong px-4 py-14 text-center text-sm text-muted-2">
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
          const open = openId === material.id;
          return (
            <li
              key={material.id}
              className="flex flex-col rounded-xl border border-line bg-surface px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <button
                  onClick={() => togglePreview(material.id)}
                  aria-expanded={open}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-ink">{material.title}</p>
                  <p className="truncate text-[12.5px] text-muted-2">
                    {material.kind.toLowerCase()}
                    {material.slideCount !== null ? ` · ${material.slideCount} slides` : ""}
                    {material.sourceFileName ? ` · ${material.sourceFileName}` : ""}
                    {` · ${shortDate(material.createdAt)}`}
                  </p>
                </button>
                <button
                  onClick={() => generate(material.id, "flashcards", material.flashcardCount)}
                  disabled={generating !== null}
                  className="rounded-md px-2 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-brand-soft/50 hover:text-brand-ink disabled:opacity-50"
                >
                  {generating === `${material.id}:flashcards`
                    ? "Generating…"
                    : material.flashcardCount > 0
                      ? `${material.flashcardCount} cards`
                      : "Flashcards"}
                </button>
                <button
                  onClick={() => generate(material.id, "quiz", material.quizCount)}
                  disabled={generating !== null}
                  className="rounded-md px-2 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-brand-soft/50 hover:text-brand-ink disabled:opacity-50"
                >
                  {generating === `${material.id}:quiz`
                    ? "Generating…"
                    : material.quizCount > 0
                      ? `${material.quizCount} questions`
                      : "Quiz"}
                </button>
                <button
                  onClick={() =>
                    remove(
                      material.id,
                      material.title,
                      material.flashcardCount,
                      material.quizCount
                    )
                  }
                  disabled={deleting === material.id}
                  aria-label={`Delete ${material.title}`}
                  className="rounded-md p-1.5 text-muted-2 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
              {open && (
                <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-line px-3 py-2">
                  {loadingPreview === material.id ? (
                    <p className="text-[13px] text-muted-2">Loading…</p>
                  ) : previews[material.id]?.trim() ? (
                    <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink">
                      {previews[material.id]}
                    </pre>
                  ) : (
                    <p className="text-[13px] text-muted-2">No text was extracted from this file.</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
