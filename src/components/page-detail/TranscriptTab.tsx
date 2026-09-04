"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, Loader2, Sparkles } from "lucide-react";
import clsx from "@/lib/clsx";
import { RecordingPanel } from "@/components/recording/RecordingPanel";
import { AudioUploadDropzone } from "@/components/recording/AudioUploadDropzone";
import { TranscriptView } from "@/components/page-detail/TranscriptView";
import { SyncedTranscriptPlayer } from "@/components/page-detail/SyncedTranscriptPlayer";
import type { Chapter, TranscriptSegment } from "@/types";

export function TranscriptTab({
  pageId,
  hasAudio,
  isVideo,
  transcript,
  cleanText,
  chapters,
  segments,
}: {
  pageId: string;
  hasAudio: boolean;
  isVideo: boolean;
  transcript: string | null;
  cleanText: string | null;
  chapters: Chapter[];
  segments: TranscriptSegment[];
}) {
  const router = useRouter();
  const [view, setView] = useState<"clean" | "raw">(cleanText ? "clean" : "raw");
  const [cleaning, setCleaning] = useState(false);
  const [chaptering, setChaptering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const src = `/api/pages/${pageId}/audio`;
  // Audio + timestamped segments get the synced player (click a line to seek,
  // live highlight); it renders both the player and the transcript.
  const synced = hasAudio && !isVideo && !!transcript && segments.length > 0;
  const showClean = view === "clean" && !!cleanText;

  async function detectChapters() {
    setChaptering(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/chapters`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Chapter detection failed. Try again.");
      else router.refresh();
    } catch {
      setError("Chapter detection failed. Try again.");
    } finally {
      setChaptering(false);
    }
  }

  async function cleanup() {
    setCleaning(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/cleanup-transcript`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Transcript cleanup failed. Try again.");
      } else {
        setView("clean");
        router.refresh();
      }
    } catch {
      setError("Transcript cleanup failed. Try again.");
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {hasAudio && isVideo && <video controls src={src} className="max-h-80 w-full rounded-xl bg-black" />}
      {hasAudio && !isVideo && (!synced || showClean) && <audio controls src={src} className="w-full" />}

      {!hasAudio && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RecordingPanel pageId={pageId} />
          <AudioUploadDropzone pageId={pageId} />
        </div>
      )}

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
                    view === v ? "bg-brand-soft text-brand" : "text-muted hover:text-ink-soft"
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
            title="Remove filler words, collapse self-corrections, and fix speech-recognition errors — the original stays available"
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
