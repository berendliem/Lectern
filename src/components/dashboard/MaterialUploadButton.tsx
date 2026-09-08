"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { extractPdfText, type OcrProgress } from "@/lib/pdf-extract";
import { extractDocxText, extractPptxText } from "@/lib/office-extract";

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
  const [ocr, setOcr] = useState<OcrProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Closing the modal leaves the component mounted, so without this the
  // extraction runs on — and a minutes-long OCR pass would eventually drop
  // the abandoned file's text into whatever the modal is showing next.
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  function reset() {
    setKind("SLIDES");
    setOcr(null);
    setTitle("");
    setText("");
    setSourceFileName(null);
    setSlideCount(null);
    setError(null);
  }

  function close() {
    abortRef.current?.abort();
    setBusy(false);
    setOpen(false);
    reset();
  }

  async function handleFile(file: File) {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setText("");
    setSourceFileName(null);
    setSlideCount(null);
    setOcr(null);
    setBusy(true);
    try {
      // `accept` is only a hint — a file picked through "All Files" still
      // arrives here, so route on the extension rather than assuming PDF.
      const kindOfFile = /\.pptx$/i.test(file.name)
        ? "pptx"
        : /\.docx$/i.test(file.name)
          ? "docx"
          : /\.pdf$/i.test(file.name)
            ? "pdf"
            : null;

      if (!kindOfFile) {
        setError("Only PDF, PowerPoint (.pptx) and Word (.docx) files can be read.");
        return;
      }

      const extracted =
        kindOfFile === "pptx"
          ? await extractPptxText(file)
          : {
              text:
                kindOfFile === "docx"
                  ? await extractDocxText(file)
                  : await extractPdfText(file, {
                      onOcrProgress: setOcr,
                      signal: abort.signal,
                    }),
              slideCount: null,
            };

      if (!extracted.text) {
        setError(
          kindOfFile === "pptx"
            ? "That deck has no selectable text — image-only slides aren't supported."
            : kindOfFile === "docx"
              ? "That document has no readable text."
              : "Couldn't read any text from that PDF, even by OCR-ing its pages."
        );
        return;
      }

      setText(extracted.text);
      setSlideCount(extracted.slideCount);
      setSourceFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.(pptx|docx|pdf)$/i, ""));
      if (kindOfFile === "pptx") setKind("SLIDES");
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : "Could not read that file.");
      }
    } finally {
      if (!abort.signal.aborted) {
        setOcr(null);
        setBusy(false);
      }
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
      close();
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
      <Modal open={open} onClose={close} title="Add course material">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex gap-1 rounded-lg border border-line p-0.5 text-[12.5px] font-medium">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={
                  kind === k.value
                    ? "flex-1 rounded-md bg-brand-soft px-2 py-1 text-brand-ink"
                    : "flex-1 rounded-md px-2 py-1 text-muted hover:text-ink-soft"
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
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line-strong px-4 py-3 text-[13px] text-muted transition-colors hover:border-brand-border hover:bg-brand-soft/40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand-ink" strokeWidth={2} />
            ) : (
              <FileText className="h-4 w-4 text-brand-ink" strokeWidth={2} />
            )}
            <span role="status" aria-live="polite">
              {!busy
                ? "Choose a PDF, PowerPoint or Word file"
                : ocr
                  ? `Reading scanned page ${ocr.page} of ${ocr.pages}…`
                  : "Extracting text…"}
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.pptx,.docx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />

          {text && (
            <p className="text-[12.5px] text-muted">
              {slideCount !== null ? `${slideCount} slides · ` : ""}
              {text.length.toLocaleString()} characters extracted in your browser. The file itself is
              never uploaded.
            </p>
          )}

          {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
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
