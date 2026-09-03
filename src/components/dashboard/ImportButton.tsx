"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Textarea } from "@/components/ui/Input";
import { extractPdfText } from "@/lib/pdf-extract";

export function ImportButton({ folderId }: { folderId?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function close() {
    setOpen(false);
    setTitle("");
    setText("");
    setError(null);
  }

  async function handlePdf(file: File) {
    setError(null);
    setExtracting(true);
    try {
      const extracted = await extractPdfText(file);
      if (!extracted) {
        setError("Couldn't find any selectable text in that PDF (scanned images aren't supported).");
      } else {
        setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${extracted}` : extracted));
        if (!title.trim()) setTitle(file.name.replace(/\.pdf$/i, ""));
      }
    } catch {
      setError("Could not read that PDF.");
    } finally {
      setExtracting(false);
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
        body: JSON.stringify({ title: title.trim(), text: text.trim(), folderId }),
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
      <Modal open={open} onClose={close} title="Import notes or a PDF">
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
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-3 text-[13px] text-zinc-500 transition-colors hover:border-brand-border hover:bg-brand-soft/40"
          >
            {extracting ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand" strokeWidth={2} />
            ) : (
              <FileText className="h-4 w-4 text-brand" strokeWidth={2} />
            )}
            {extracting ? "Extracting text…" : "Choose a PDF (text is extracted in your browser)"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePdf(file);
              e.target.value = "";
            }}
          />

          <Textarea
            rows={6}
            placeholder="…or paste notes / readings here."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

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
