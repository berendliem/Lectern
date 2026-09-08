"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { extractPdfText, type OcrProgress } from "@/lib/pdf-extract";
import { extractDocxText, extractPptxText } from "@/lib/office-extract";
import { SCAN_IMAGE_RE, titleFromPath } from "@/lib/drop-intake";
import { scanPagesToMarkdown, type ScanProgress } from "@/lib/scan-notes";

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
  const [scan, setScan] = useState<ScanProgress | null>(null);
  // Set once the text came from photographed pages, which is the one path
  // where a file leaves the machine — the modal has to say so.
  const [scanned, setScanned] = useState(false);
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
    setScan(null);
    setScanned(false);
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

  async function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setText("");
    setSourceFileName(null);
    setSlideCount(null);
    setOcr(null);
    setScan(null);
    setScanned(false);
    setBusy(true);
    try {
      // Photos are the one multi-file case: a set of pages is one set of
      // notes, so they are read in order and saved as a single material.
      const photos = files.filter((f) => SCAN_IMAGE_RE.test(f.name));
      if (photos.length > 0) {
        if (photos.length !== files.length) {
          setError("Pick either photos of your notes or one document — not both at once.");
          return;
        }
        const markdown = await scanPagesToMarkdown(photos, {
          signal: abort.signal,
          onProgress: setScan,
        });
        setText(markdown);
        setScanned(true);
        setSourceFileName(
          photos.length === 1 ? photos[0].name : `${photos.length} photos, from ${photos[0].name}`
        );
        if (!title.trim()) setTitle(titleFromPath(photos[0].name));
        setKind("OTHER");
        return;
      }

      if (/\.heic$/i.test(file.name)) {
        setError("HEIC photos can't be read here — export the page as JPEG and try again.");
        return;
      }

      // The picker allows several files for the photo case above. Documents
      // are one per material, and silently reading the first of four would
      // look like the other three had been saved somewhere.
      if (files.length > 1) {
        setError("One document at a time — several files at once only works for photos.");
        return;
      }

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
        setError(
          "Only PDF, PowerPoint (.pptx), Word (.docx) and photos (JPEG, PNG, WebP) can be read."
        );
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
        setScan(null);
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
                ? "Choose a PDF, PowerPoint or Word file — or photos of written notes"
                : scan
                  ? `Reading page ${scan.page} of ${scan.pages} with the AI model…`
                  : ocr
                    ? `Reading scanned page ${ocr.page} of ${ocr.pages}…`
                    : "Extracting text…"}
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            // Multiple is for photos: several pages of one set of notes become
            // one material. A document is still taken one at a time.
            multiple
            accept=".pdf,.pptx,.docx,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) handleFiles(files);
              e.target.value = "";
            }}
          />

          {text && (
            <p className="text-[12.5px] text-muted">
              {slideCount !== null ? `${slideCount} slides · ` : ""}
              {text.length.toLocaleString()} characters
              {scanned
                ? " transcribed by the AI model. The photos were sent to it to be read and are not saved — keep your originals. Check the text below before saving."
                : " extracted in your browser. The file itself is never uploaded."}
            </p>
          )}

          {scanned && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              aria-label="Transcribed notes"
              className="rounded-lg border border-line bg-surface px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink"
            />
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
