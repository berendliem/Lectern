"use client";

import Link from "next/link";
import { Mic, Pause, Play, Square } from "lucide-react";
import { confirmDiscard, useRecording } from "@/components/recording/RecordingProvider";
import { Button } from "@/components/ui/Button";
import { formatElapsed } from "@/lib/format";

/**
 * Shell-level controls for the one recording session. A lecture recorded from
 * the Transcript tab stays reachable from the dashboard, another course, or the
 * review queue — including its save, so stopping from here never strands audio.
 */
export function RecordingBar() {
  const {
    session, status, elapsedSeconds, level, audioBlob,
    saving, saveError, pause, resume, stop, discard, save,
  } = useRecording();

  if (!session) return null;
  const unsaved = status === "stopped" && !!audioBlob;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line/80 bg-red-50 px-4 py-2 text-[12.5px] sm:px-8 dark:bg-red-950/30">
      <span className="flex items-center gap-1.5 font-medium text-red-700">
        <Mic className="h-3.5 w-3.5" strokeWidth={2.4} />
        {status === "paused" ? "Paused" : unsaved ? "Unsaved recording" : "Recording"}
      </span>
      <span className="font-mono tabular-nums text-ink-soft">{formatElapsed(elapsedSeconds)}</span>
      {status === "recording" && (
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
          <span
            className="block h-full rounded-full bg-red-500 transition-all"
            style={{ width: `${Math.min(100, level * 220)}%` }}
          />
        </span>
      )}
      <Link href={`/pages/${session.pageId}`} className="truncate font-medium text-brand-ink underline">
        {session.pageTitle}
      </Link>
      <span className="ml-auto flex items-center gap-1.5">
        {status === "recording" && (
          <Button size="sm" variant="secondary" onClick={pause}>
            <Pause className="h-3.5 w-3.5" strokeWidth={2.2} /> Pause
          </Button>
        )}
        {status === "paused" && (
          <Button size="sm" onClick={resume}>
            <Play className="h-3.5 w-3.5" strokeWidth={2.2} /> Resume
          </Button>
        )}
        {(status === "recording" || status === "paused") && (
          <Button size="sm" variant="danger" onClick={stop}>
            <Square className="h-3.5 w-3.5" strokeWidth={2.2} /> Stop
          </Button>
        )}
        {unsaved && (
          <>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save & transcribe"}
            </Button>
            {/* Never gated on `saving`: while a save is in flight this is the
                one control that still works, and it is what frees the user from
                a hung upload. */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (confirmDiscard(session, elapsedSeconds)) discard();
              }}
            >
              Discard
            </Button>
          </>
        )}
      </span>
      {saveError && (
        <p className="w-full font-medium text-red-700">
          {saveError} —{" "}
          <Link href={`/pages/${session.pageId}`} className="underline">
            open the lecture to download the recording
          </Link>
          .
        </p>
      )}
    </div>
  );
}
