"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileAudio, FileImage, FileText, Loader2, UploadCloud } from "lucide-react";
import clsx from "@/lib/clsx";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { collectDropFiles, expandZips, MAX_DROPPED_FILES } from "@/lib/drop-files";
import { MAX_SCAN_PAGES, MAX_TEXT_CHARS } from "@/lib/limits";
import { routeDropFile, titleFromPath, type MaterialKind } from "@/lib/drop-intake";
import { extractPdfText, type OcrProgress } from "@/lib/pdf-extract";
import { extractDocxText, extractPptxText } from "@/lib/office-extract";
import { parseExternalTranscript, segmentsToRawText } from "@/lib/transcript-import";
import { scanPagesToMarkdown } from "@/lib/scan-notes";

const KINDS: MaterialKind[] = ["SYLLABUS", "SLIDES", "READING", "OTHER"];
const KIND_LABEL: Record<MaterialKind, string> = {
  SYLLABUS: "Syllabus",
  SLIDES: "Slides",
  READING: "Reading",
  OTHER: "Other",
};

type RowStatus = "ready" | "skip" | "working" | "saved" | "failed";

type Row = {
  path: string;
  title: string;
  file: File;
  /** Materials only; a transcript row carries no kind. */
  kind: MaterialKind | null;
  extract: "pdf" | "pptx" | "docx" | "txt" | "image" | null;
  dest: "material" | "lecture" | "skip";
  status: RowStatus;
  note: string | null;
};

const tooLong = (chars: number) =>
  `too long — ${chars.toLocaleString()} characters, the limit is ${MAX_TEXT_CHARS.toLocaleString()}`;

function toRow(path: string, file: File): Row {
  const route = routeDropFile(path);
  const base = { path, title: titleFromPath(path), file };
  if (route.dest === "skip") {
    return { ...base, kind: null, extract: null, dest: "skip", status: "skip", note: route.reason };
  }
  if (route.dest === "lecture") {
    return { ...base, kind: null, extract: null, dest: "lecture", status: "ready", note: null };
  }
  return {
    ...base,
    kind: route.kind,
    extract: route.extract,
    dest: "material",
    status: "ready",
    note: null,
  };
}

export function CourseDropZone({
  folderId,
  children,
}: {
  folderId: string;
  children: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Two different reasons a file is not in the list, and the copy used to
  // blame the file cap for both.
  const [ignored, setIgnored] = useState(0);
  const [overflowed, setOverflowed] = useState(0);
  const [refused, setRefused] = useState<string[]>([]);
  // Dragging over a child fires dragleave on the parent, so a plain boolean
  // makes the overlay flicker across the tab's contents.
  const depth = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  function close() {
    abortRef.current?.abort();
    setRows(null);
    setSaving(false);
    setProgress(null);
    setError(null);
    setIgnored(0);
    setOverflowed(0);
    setRefused([]);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    setError(null);

    // Snapshot before the first await: dataTransfer empties when the event ends.
    const collected = collectDropFiles(e.dataTransfer);
    setScanning(true);
    try {
      const { files, ignored: skippedByZip, refused: refusedZips } = await expandZips(
        await collected
      );
      setRefused(refusedZips);
      if (files.length === 0) {
        // Nothing to show a list for, but the user still needs to know why.
        if (refusedZips.length > 0) setError(`${refusedZips.join("; ")}.`);
        return;
      }
      setIgnored(skippedByZip);
      setOverflowed(Math.max(0, files.length - MAX_DROPPED_FILES));
      // Every photo is a paid model call, so a dropped folder of them is
      // capped where a dropped folder of PDFs is not.
      let photoBudget = MAX_SCAN_PAGES;
      setRows(
        files.slice(0, MAX_DROPPED_FILES).map(({ path, file }) => {
          const row = toRow(path, file);
          if (row.extract !== "image" || photoBudget-- > 0) return row;
          return {
            ...row,
            kind: null,
            extract: null,
            dest: "skip",
            status: "skip",
            note: `over the ${MAX_SCAN_PAGES}-photo limit for one drop`,
          };
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read what you dropped.");
    } finally {
      setScanning(false);
    }
  }

  /** Extracts and saves one row. Throws with a user-readable message. */
  async function saveRow(row: Row, signal: AbortSignal, onOcr: (p: OcrProgress | null) => void) {
    if (row.dest === "lecture") {
      const parsed = parseExternalTranscript(row.file.name, await row.file.text());
      if (parsed.segments.length === 0) {
        throw new Error("no timestamped lines — import it by hand if it's a plain transcript");
      }
      const text = segmentsToRawText(parsed.segments);
      if (text.length > MAX_TEXT_CHARS) throw new Error(tooLong(text.length));

      const res = await fetch("/api/pages/from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          title: row.title,
          text,
          folderId,
          segments: parsed.segments,
          source: parsed.format === "text" ? "import" : "subtitles",
        }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? "the server rejected it");
      }
      return;
    }

    const extracted =
      row.extract === "pptx"
        ? await extractPptxText(row.file)
        : {
            text:
              row.extract === "txt"
                ? await row.file.text()
                : row.extract === "docx"
                  ? await extractDocxText(row.file)
                  : row.extract === "image"
                    ? await scanPagesToMarkdown([row.file], { signal })
                    : await extractPdfText(row.file, { onOcrProgress: onOcr, signal }),
            slideCount: null,
          };

    if (!extracted.text.trim()) throw new Error("no readable text in it");
    if (extracted.text.length > MAX_TEXT_CHARS) throw new Error(tooLong(extracted.text.length));

    const res = await fetch(`/api/folders/${folderId}/materials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        kind: row.kind,
        title: row.title,
        text: extracted.text,
        sourceFileName: row.file.name,
        ...(extracted.slideCount !== null ? { slideCount: extracted.slideCount } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error((await res.json().catch(() => ({}))).error ?? "the server rejected it");
    }
  }

  async function saveAll() {
    // Two fast clicks would otherwise each build a queue from the same rows
    // and POST every one of them twice; `disabled` only reflects the last
    // committed render.
    if (!rows || saving) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setSaving(true);
    setError(null);

    const queue = rows.map((row, index) => ({ row, index })).filter((r) => r.row.status === "ready");
    let done = 0;
    let savedAny = false;

    // Closing the modal aborts mid-flight work and nulls `rows`, so every
    // write-back after an await checks both before touching state.
    const mark = (index: number, patch: Partial<Row>) => {
      if (abort.signal.aborted) return;
      setRows((current) => current?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? null);
    };

    try {
      for (const { row, index } of queue) {
        if (abort.signal.aborted) return;
        done += 1;
        const at = (label: string) => setProgress(`${done} of ${queue.length} · ${label}`);
        // A photo waits on a model call, not on this tab, and the wait is long
        // enough that "reading" alone looks like the app has hung.
        const reading =
          row.extract === "image"
            ? `reading ${row.file.name} with the AI model`
            : `reading ${row.file.name}`;
        at(reading);
        mark(index, { status: "working" });

        // One at a time on purpose: extraction runs in this tab, and a scanned
        // PDF OCRs page by page. Running the queue in parallel would starve the
        // UI thread and make the progress line meaningless.
        let status: RowStatus = "saved";
        let note: string | null = null;
        try {
          await saveRow(row, abort.signal, (ocr) =>
            at(ocr ? `OCR-ing page ${ocr.page} of ${ocr.pages} of ${row.file.name}` : reading)
          );
          savedAny = true;
        } catch (err) {
          if (abort.signal.aborted) return;
          status = "failed";
          // A failed row is reported and the queue carries on: one unreadable
          // PDF in a dropped folder must not cost the user the other twenty.
          note = err instanceof Error ? err.message : "could not be saved";
        }
        mark(index, { status, note });
      }
    } finally {
      if (!abort.signal.aborted) {
        setSaving(false);
        setProgress(null);
      }
      // Rows saved before a cancel are real writes; the course page has to
      // show them even though the run was cut short.
      if (savedAny) router.refresh();
    }
  }

  const ready = rows?.filter((r) => r.status === "ready").length ?? 0;
  const saved = rows?.filter((r) => r.status === "saved").length ?? 0;
  const failed = rows?.filter((r) => r.status === "failed").length ?? 0;
  // Photos are the one kind of row that leaves the machine, so the modal has
  // to say so before the user presses Add.
  const photos = rows?.filter((r) => r.extract === "image" && r.status === "ready").length ?? 0;
  const finished = rows !== null && ready === 0 && (saved > 0 || failed > 0);

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        // Counted for every enter, not just file drags: the matching dragleave
        // fires either way, and an asymmetric count drops the overlay while
        // the pointer is still inside.
        depth.current += 1;
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      // A drag cancelled outside the window never sends a final dragleave,
      // which would leave the overlay stuck over the tab.
      onDragEnd={() => {
        depth.current = 0;
        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      {children}

      {(dragging || scanning) && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-border bg-brand-soft/80 backdrop-blur-[1px]">
          <p className="flex items-center gap-2 text-sm font-medium text-brand-ink" role="status">
            {scanning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Unpacking…
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" strokeWidth={2} /> Drop files, a folder, or a .zip
              </>
            )}
          </p>
        </div>
      )}

      {error && !rows && <p className="mt-3 text-[13px] font-medium text-red-700">{error}</p>}

      <Modal open={rows !== null} onClose={close} title="Add what you dropped">
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">
            {finished
              ? `${saved} added${failed > 0 ? `, ${failed} failed` : ""}.`
              : `${ready} of ${rows?.length ?? 0} files can be added. Text is extracted in your browser — the files themselves are never uploaded.${
                  photos > 0
                    ? ` The ${photos === 1 ? "photo" : `${photos} photos`} are the exception: a photo is sent to the AI model to be read, and only the text it returns is saved.`
                    : ""
                }`}
            {overflowed > 0 &&
              ` ${overflowed} more were ignored (${MAX_DROPPED_FILES}-file limit).`}
            {ignored > 0 && ` ${ignored} were left inside their archive (too large).`}
          </p>

          {refused.length > 0 && (
            <ul className="flex flex-col gap-1 text-[12.5px] text-red-700">
              {refused.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          )}

          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {rows?.map((row, index) => (
              <li
                // Two zips can each carry a top-level `syllabus.pdf`, so the
                // path alone is not unique.
                key={`${index}-${row.path}`}
                className={clsx(
                  "flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[12.5px]",
                  row.status === "skip" && "opacity-55"
                )}
              >
                {row.dest === "lecture" ? (
                  <FileAudio className="h-3.5 w-3.5 shrink-0 text-brand-ink" strokeWidth={2} />
                ) : row.extract === "image" ? (
                  <FileImage className="h-3.5 w-3.5 shrink-0 text-brand-ink" strokeWidth={2} />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-brand-ink" strokeWidth={2} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{row.path}</span>
                  <span
                    className={clsx(
                      "block truncate",
                      row.status === "failed" ? "text-red-700" : "text-muted-2"
                    )}
                  >
                    {row.note
                      ? row.note
                      : row.status === "saved"
                        ? "added"
                        : row.status === "working"
                          ? "working…"
                          : row.dest === "lecture"
                            ? "new lecture"
                            : row.extract === "image"
                              ? "photo · read by AI"
                              : "material"}
                  </span>
                </span>
                {row.dest === "material" && row.status !== "saved" && (
                  <select
                    value={row.kind ?? "READING"}
                    disabled={saving}
                    aria-label={`Kind for ${row.path}`}
                    onChange={(e) =>
                      setRows((current) =>
                        current?.map((r, i) =>
                          i === index ? { ...r, kind: e.target.value as MaterialKind } : r
                        ) ?? null
                      )
                    }
                    className="shrink-0 rounded-md border border-line bg-surface px-1.5 py-1 text-[12px] text-ink-soft"
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>

          {progress && (
            <p className="text-[12.5px] text-muted" role="status" aria-live="polite">
              {progress}
            </p>
          )}
          {error && rows && <p className="text-[13px] font-medium text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              {finished ? "Done" : "Cancel"}
            </Button>
            {!finished && (
              <Button
                type="button"
                variant="brand"
                onClick={saveAll}
                disabled={saving || ready === 0}
              >
                {saving ? "Adding…" : `Add ${ready}`}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
