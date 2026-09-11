"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { confirmDiscard, useRecording } from "@/components/recording/RecordingProvider";
import type { RecorderStatus } from "@/components/recording/useMediaRecorder";
import { Button } from "@/components/ui/Button";
import { formatElapsed } from "@/lib/format";

export function RecordingPanel({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const {
    session,
    status,
    elapsedSeconds,
    level,
    audioBlob,
    error,
    liveTranscript,
    liveBusy,
    saving,
    saveError,
    start,
    pause,
    resume,
    stop,
    discard,
    save,
  } = useRecording();

  const mine = session?.pageId === pageId;
  const elsewhere = session !== null && !mine;
  const busy = saving;
  // A session belonging to another lecture must not leak into this panel's
  // timer, level meter, or preview.
  const shown: RecorderStatus = mine ? status : "idle";
  const previewUrl = useMemo(
    () => (mine && audioBlob ? URL.createObjectURL(audioBlob) : null),
    [mine, audioBlob]
  );

  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const liveEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    liveEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [liveTranscript]);

  // "audio/webm;codecs=opus" -> "webm". Good enough for a filename.
  const downloadName = `recording.${audioBlob?.type.split(";")[0].split("/")[1] ?? "webm"}`;

  async function handleExplain() {
    const context = liveTranscript.slice(-2000);
    if (context.length < 10) return;
    setExplaining(true);
    setExplainError(null);
    const res = await fetch("/api/live-explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    });
    setExplaining(false);
    if (res.ok) {
      const { explanation: text } = await res.json();
      setExplanation(text);
    } else {
      const body = await res.json().catch(() => ({}));
      setExplainError(body.error ?? "Couldn't get an explanation right now.");
    }
  }

  if (elsewhere && session) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line/80 bg-surface p-6 text-sm text-muted">
        <p>
          A recording is running for{" "}
          <Link href={`/pages/${session.pageId}`} className="font-medium text-brand-ink underline">
            {session.pageTitle}
          </Link>
          . Stop it before recording here — one microphone, one recording.
        </p>
      </div>
    );
  }

  const inSession = shown === "recording" || shown === "paused";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line/80 bg-surface p-6">
      <div className="flex flex-col items-center gap-3">
        <div className="font-mono text-3xl tabular-nums text-ink">{formatElapsed(mine ? elapsedSeconds : 0)}</div>

        {shown === "recording" && (
          <div className="h-2 w-48 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-red-500 transition-all"
              style={{ width: `${Math.min(100, level * 220)}%` }}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {shown === "idle" && <Button onClick={() => start({ id: pageId, title: pageTitle })}>Start recording</Button>}
          {shown === "recording" && (
            <>
              <Button variant="secondary" onClick={pause}>
                Pause
              </Button>
              <Button variant="danger" onClick={stop}>
                Stop
              </Button>
            </>
          )}
          {shown === "paused" && (
            <>
              <Button onClick={resume}>Resume</Button>
              <Button variant="danger" onClick={stop}>
                Stop
              </Button>
            </>
          )}
          {shown === "stopped" && audioBlob && previewUrl && (
            <>
              <audio controls src={previewUrl} className="h-9" />
              <Button onClick={save} disabled={busy}>
                {saving ? "Saving…" : "Save & transcribe"}
              </Button>
              {/* Ungated on purpose: a save that never returns must not be able
                  to strand the take behind two disabled buttons. */}
              <Button
                variant="secondary"
                onClick={() => {
                  if (session && confirmDiscard(session, elapsedSeconds)) discard();
                }}
              >
                Discard
              </Button>
            </>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {(saveError || previewUrl) && (
          <div className="flex flex-col items-center gap-1 text-sm">
            {saveError && <p className="text-red-600">{saveError}</p>}
            {/* The recording exists only in this tab until it uploads, so this
                is offered for as long as the blob is here — not only once a save
                has already failed. A save that hangs never sets `saveError`, and
                that is exactly when the user most needs the file. */}
            {previewUrl && (
              <a href={previewUrl} download={downloadName} className="font-medium text-muted underline hover:text-ink-soft">
                Download the recording
              </a>
            )}
          </div>
        )}
      </div>

      {(inSession || (shown === "stopped" && liveTranscript)) && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-2">
              Live transcript
              {liveBusy && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin text-brand-ink" strokeWidth={2.5} />}
            </p>
            {inSession && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleExplain}
                disabled={explaining || liveTranscript.length < 10}
              >
                {explaining ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-brand-ink" strokeWidth={2.2} />
                )}
                Explain this
              </Button>
            )}
          </div>

          <div className="max-h-40 overflow-y-auto rounded-lg bg-surface-2 p-3 text-[13px] leading-6 text-ink-soft">
            {liveTranscript || <span className="text-muted-2">Listening… the transcript appears here as the lecture goes on.</span>}
            <div ref={liveEndRef} />
          </div>

          {explainError && <p className="text-xs text-red-600">{explainError}</p>}
          {explanation && (
            <div className="rounded-lg border border-brand-border bg-brand-soft/50 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-ink">Assistant</p>
              <p className="text-[13px] leading-6 text-ink-soft">{explanation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
