"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { extractPdfText } from "@/lib/pdf-extract";
import { extractPptxText } from "@/lib/office-extract";

const KINDS = [
  { value: "SYLLABUS", label: "Syllabus" },
  { value: "SLIDES", label: "Slides" },
  { value: "READING", label: "Reading" },
  { value: "OTHER", label: "Other" },
] as const;

type Kind = (typeof KINDS)[number]["value"];

export function MaterialUploadButton({ folderId }: { folderId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("SLIDES");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [slideCount, setSlideCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setError(null);
    setText("");
    setSourceFileName(null);
    setSlideCount(null);
    setBusy(true);
    try {
      const isPptx = /\.pptx$/i.test(file.name);
      const extracted = isPptx ? await extractPptxText(file) : { text: await extractPdfText(file), slideCount: null };

      if (!extracted.text) {
        setError(
          isPptx
            ? "That deck has no selectable text — image-only slides aren't supported."
            : "Couldn't find any selectable text in that PDF (scanned images aren't supported)."
        );
        return;
      }

      setText(extracted.text);
      setSlideCount(extracted.slideCount);
      setSourceFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.(pptx|pdf)$/i, ""));
      if (isPptx) setKind("SLIDES");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders/${folderId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          text,
          sourceFileName: sourceFileName ?? undefined,
          slideCount: slideCount ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save that material.");
        return;
      }
      setOpen(false);
      setTitle("");
      setText("");
      setSourceFileName(null);
      setSlideCount(null);
      router.refresh();
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" strokeWidth={2} />
        Add material
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add course material">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex gap-1 rounded-lg border border-zinc-200 p-0.5 text-[12.5px] font-medium">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={
                  kind === k.value
                    ? "flex-1 rounded-md bg-brand-soft px-2 py-1 text-brand"
                    : "flex-1 rounded-md px-2 py-1 text-zinc-500 hover:text-zinc-700"
                }
              >
                {k.label}
              </button>
            ))}
          </div>

          <Input
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-3 text-[13px] text-zinc-500 transition-colors hover:border-brand-border hover:bg-brand-soft/40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand" strokeWidth={2} />
            ) : (
              <FileText className="h-4 w-4 text-brand" strokeWidth={2} />
            )}
            {busy ? "Extracting text…" : "Choose a PDF or PowerPoint"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />

          {text && (
            <p className="text-[12.5px] text-zinc-500">
              {slideCount !== null ? `${slideCount} slides · ` : ""}
              {text.length.toLocaleString()} characters extracted in your browser. The file itself is
              never uploaded.
            </p>
          )}

          {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={submitting || !title.trim() || !text.trim()}>
              {submitting ? "Saving…" : "Save material"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
