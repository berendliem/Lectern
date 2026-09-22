"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, Loader2, Sparkles } from "lucide-react";
import clsx from "@/lib/clsx";
import { RecordingPanel } from "@/components/recording/RecordingPanel";
import { useRecording } from "@/components/recording/RecordingProvider";
import { AudioUploadDropzone } from "@/components/recording/AudioUploadDropzone";
import { UrlImport } from "@/components/recording/UrlImport";
import { TranscriptView } from "@/components/page-detail/TranscriptView";
import { SyncedTranscriptPlayer } from "@/components/page-detail/SyncedTranscriptPlayer";
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";
import type { Chapter, TranscriptSegment } from "@/types";

export function TranscriptTab({
  pageId,
  pageTitle,
  hasAudio,
  isVideo,
  transcript,
  cleanText,
  chapters,
  segments,
  materials,
  hasContext,
}: {
  pageId: string;
  pageTitle: string;
  hasAudio: boolean;
  isVideo: boolean;
  transcript: string | null;
  cleanText: string | null;
  chapters: Chapter[];
  segments: TranscriptSegment[];
  /** The course's decks and readings, for attaching one as this lecture's context. */
  materials: { id: string; title: string; kind: string }[];
  /** Whether a deck or reading is already attached. */
  hasContext: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"clean" | "raw">(cleanText ? "clean" : "raw");
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const { run, task, clear } = useTasks();
  const { session, audioBlob } = useRecording();
  const chapterKey = `page:${pageId}:chapters`;
  const cleanKey = `page:${pageId}:cleanup`;
  const chaptering = task(chapterKey)?.status === "running";
  const cleaning = task(cleanKey)?.status === "running";
  const error = task(chapterKey)?.error ?? task(cleanKey)?.error ?? null;

  const src = `/api/pages/${pageId}/audio`;
  // Audio + timestamped segments get the synced player (click a line to seek,
  // live highlight); it renders both the player and the transcript.
  const synced = hasAudio && !isVideo && !!transcript && segments.length > 0;
  const showClean = view === "clean" && !!cleanText;

  async function detectChapters() {
    clear([chapterKey]);
    await run({ key: chapterKey, label: "Detecting chapters…", href: `/pages/${pageId}` }, async () => {
      await postTask(`/api/pages/${pageId}/chapters`, "Chapter detection failed. Try again.");
    });
    router.refresh();
  }

  async function cleanup() {
    // Both readouts below share one line, so an action starts by dropping its
    // own last failure — the same way every local error state is cleared.
    clear([cleanKey]);
    let ok = false;
    await run({ key: cleanKey, label: "Cleaning up the transcript…", href: `/pages/${pageId}` }, async () => {
      await postTask(`/api/pages/${pageId}/cleanup-transcript`, "Transcript cleanup failed. Try again.");
      ok = true;
    });
    if (ok) setView("clean");
    router.refresh();
  }

  async function attachContext(materialId: string) {
    if (!materialId) return;
    const material = materials.find((m) => m.id === materialId);
    // Replacing a context layer throws away the text already attached, and on a
    // page whose material has since been deleted this page is its only holder.
    if (
      hasContext &&
      !confirm(
        `Replace the slides attached to this lecture with "${material?.title ?? "that material"}"? The text currently attached is discarded.`
      )
    ) {
      return;
    }
    setAttaching(true);
    setAttachError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, replace: hasContext }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAttachError(data.error ?? "Could not attach that material.");
        return;
      }
      router.refresh();
    } catch {
      setAttachError("Network error talking to the local server.");
    } finally {
      setAttaching(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {hasAudio && isVideo && <video controls src={src} className="max-h-80 w-full rounded-xl bg-black" />}
      {hasAudio && !isVideo && (!synced || showClean) && <audio controls src={src} className="w-full" />}

      {/* The panel also has to be here when audio already exists but this
          lecture still holds an unsaved take: on the transcribe-failure path the
          upload succeeded and `hasAudio` flipped, and the shell bar sends the
          user here to download or re-save the recording. Without this the link
          lands on a page with no panel on it. */}
      {(!hasAudio || (session?.pageId === pageId && audioBlob !== null)) && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RecordingPanel pageId={pageId} pageTitle={pageTitle} />
            {!hasAudio && <AudioUploadDropzone pageId={pageId} />}
          </div>
          {!hasAudio && <UrlImport pageId={pageId} />}
        </div>
      )}

      {transcript && materials.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-[13px] text-ink-soft">
          <span>
            {hasContext
              ? "Slides are attached to this lecture — the notes use both."
              : "Taught from a deck? Attach it and the notes will follow its structure."}
          </span>
          <select
            value=""
            onChange={(e) => attachContext(e.target.value)}
            disabled={attaching}
            aria-label="Attach a deck or reading as this lecture's context"
            className="ml-auto rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px]"
          >
            <option value="" disabled>
              {hasContext ? "Replace with…" : "Use a deck as context…"}
            </option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {attachError && <p className="text-[13px] font-medium text-red-700">{attachError}</p>}

      {transcript && (
        <div className="flex flex-wrap items-center gap-2">
          {cleanText && (
            <div className="flex rounded-lg border border-line p-0.5 text-[12.5px] font-medium">
              {(["clean", "raw"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={clsx(
                    "rounded-md px-2.5 py-1 transition-colors",
                    view === v ? "bg-brand-soft text-brand-ink" : "text-muted hover:text-ink-soft"
                  )}
                >
                  {v === "clean" ? "Cleaned" : "Raw + timestamps"}
                </button>
              ))}
            </div>
          )}
          {segments.length >= 4 && (
            <button
              onClick={detectChapters}
              disabled={chaptering}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
              title="Divide the lecture into named topic chapters you can jump between"
            >
              {chaptering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <BookMarked className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
              {chaptering ? "Detecting…" : chapters.length > 0 ? "Re-detect chapters" : "Detect chapters"}
            </button>
          )}
          <button
            onClick={cleanup}
            disabled={cleaning}
            className={clsx(
              "flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-50",
              segments.length < 4 && "ml-auto"
            )}
            title="Cut filler, student chatter, tangents and course admin, and fix speech-recognition errors — the original stays available"
          >
            {cleaning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
            {cleaning ? "Cleaning up…" : cleanText ? "Re-clean transcript" : "Clean up transcript"}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {showClean && cleanText ? (
        <TranscriptView rawText={cleanText} segments={[]} />
      ) : synced ? (
        <SyncedTranscriptPlayer src={src} segments={segments} chapters={chapters} />
      ) : transcript ? (
        <TranscriptView rawText={transcript} segments={segments} />
      ) : hasAudio ? (
        <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted-2">
          Audio saved. Use the banner above to transcribe it and generate study materials.
        </div>
      ) : null}
    </div>
  );
}
