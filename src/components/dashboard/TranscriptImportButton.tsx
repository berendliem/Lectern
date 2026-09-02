"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileAudio, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { extractDocxText } from "@/lib/office-extract";
import { parseExternalTranscript, segmentsToRawText } from "@/lib/transcript-import";

export function TranscriptImportButton({ folderId }: { folderId?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [parsed, setParsed] = useState<ReturnType<typeof parseExternalTranscript> | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setError(null);
    setParsed(null);
    setBusy(true);
    try {
      const content = /\.docx$/i.test(file.name) ? await extractDocxText(file) : await file.text();
      const result = parseExternalTranscript(file.name, content);

      if (result.segments.length === 0) {
        setError(
          "No timestamped lines found in that file. Teams, Zoom, and Otter exports work; a plain paste should use Import instead."
        );
        return;
      }

      setParsed(result);
      if (!title.trim()) setTitle(file.name.replace(/\.(vtt|srt|docx|txt)$/i, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !parsed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pages/from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          text: segmentsToRawText(parsed.segments),
          folderId,
          segments: parsed.segments,
          source: parsed.format === "text" ? "import" : "subtitles",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not import that transcript.");
        return;
      }
      router.push(`/pages/${data.page.id}`);
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileAudio className="h-4 w-4" strokeWidth={2} />
        Import transcript
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import a transcript">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Lecture title"
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
              <FileAudio className="h-4 w-4 text-brand" strokeWidth={2} />
            )}
            {busy ? "Reading…" : "Choose a .vtt, .srt, .docx or .txt transcript"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".vtt,.srt,.docx,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />

          {parsed && (
            <p className="text-[12.5px] text-zinc-500">
              {parsed.segments.length} segments
              {parsed.speakers.length > 0 ? ` · ${parsed.speakers.join(", ")}` : " · no speaker labels"}
            </p>
          )}

          {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={submitting || !title.trim() || !parsed}>
              {submitting ? "Importing…" : "Import"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
