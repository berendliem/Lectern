"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Textarea } from "@/components/ui/Input";
import { extractPdfText, type OcrProgress } from "@/lib/pdf-extract";
import { extractPptxText } from "@/lib/office-extract";

export function ImportButton({ folderId }: { folderId?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  // Slides of a lecture with no recording: summarized with a prompt that fills
  // the gaps a terse deck leaves, in marked callouts.
  const [slides, setSlides] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [ocr, setOcr] = useState<OcrProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Closing the modal leaves the component mounted, so without this the
  // extraction runs on — and a minutes-long OCR pass would eventually drop
  // the abandoned file's text into whatever the modal is showing next.
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  function close() {
    abortRef.current?.abort();
    setExtracting(false);
    setOcr(null);
    setOpen(false);
    setTitle("");
    setText("");
    setSlides(false);
    setError(null);
  }

  async function handleFile(file: File) {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setOcr(null);
    setExtracting(true);
    const isPptx = /\.pptx$/i.test(file.name);
    try {
      const extracted = isPptx
        ? (await extractPptxText(file)).text
        : await extractPdfText(file, { onOcrProgress: setOcr, signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!extracted) {
        setError(
          isPptx
            ? "Couldn't read any text from that deck. If its slides are images, export it as a PDF and import that instead."
            : "Couldn't read any text from that PDF, even by OCR-ing its pages."
        );
      } else {
        setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${extracted}` : extracted));
        if (!title.trim()) setTitle(file.name.replace(/\.(pdf|pptx)$/i, ""));
        if (isPptx) setSlides(true);
      }
    } catch (e) {
      // The deck extractor's errors are written for the user; the PDF path's are not.
      if (!abort.signal.aborted) {
        setError(isPptx && e instanceof Error ? e.message : "Could not read that PDF.");
      }
    } finally {
      if (!abort.signal.aborted) {
        setOcr(null);
        setExtracting(false);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pages/from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          text: text.trim(),
          folderId,
          source: slides ? "slides" : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not import.");
        setSubmitting(false);
        return;
      }
      router.push(`/pages/${data.page.id}`);
    } catch {
      setError("Network error talking to the local server.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" strokeWidth={2} />
        Import
      </Button>
      <Modal open={open} onClose={close} title="Import notes, a PDF, or slides">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={extracting}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line-strong px-4 py-3 text-[13px] text-muted transition-colors hover:border-brand-border hover:bg-brand-soft/40"
          >
            {extracting ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand-ink" strokeWidth={2} />
            ) : (
              <FileText className="h-4 w-4 text-brand-ink" strokeWidth={2} />
            )}
            <span role="status" aria-live="polite">
              {!extracting
                ? "Choose a PDF or PowerPoint (text is extracted in your browser)"
                : ocr
                  ? `Reading scanned page ${ocr.page} of ${ocr.pages}…`
                  : "Extracting text…"}
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />

          <Textarea
            rows={6}
            placeholder="…or paste notes / readings here."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <label className="flex items-start gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={slides}
              onChange={(e) => setSlides(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
            />
            <span>
              These are lecture slides (no recording)
              <span className="block text-muted-2">
                Notes will explain what the slides leave out, marked as added context.
              </span>
            </span>
          </label>

          {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={submitting || !title.trim() || !text.trim()}>
              {submitting ? "Importing…" : "Import"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
