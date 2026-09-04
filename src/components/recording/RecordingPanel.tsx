"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { useMediaRecorder } from "@/components/recording/useMediaRecorder";
import { uploadAudio, transcribePage } from "@/components/recording/upload";
import { Button } from "@/components/ui/Button";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordingPanel({ pageId }: { pageId: string }) {
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveBusy, setLiveBusy] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const liveEndRef = useRef<HTMLDivElement>(null);

  const handleLiveSegment = useCallback(async (blob: Blob) => {
    setLiveBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, "segment.webm");
      const res = await fetch("/api/live-transcribe", { method: "POST", body: formData });
      if (res.ok) {
        const { text } = await res.json();
        if (text?.trim()) {
          setLiveTranscript((t) => (t ? `${t} ${text.trim()}` : text.trim()));
          liveEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    } finally {
      setLiveBusy(false);
    }
  }, []);

  const {
    status,
    elapsedSeconds,
    audioBlob,
    level,
    error,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    reset,
  } = useMediaRecorder({ onLiveSegment: handleLiveSegment });
  const [saveState, setSaveState] = useState<"idle" | "uploading" | "transcribing">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const router = useRouter();
  const previewUrl = useMemo(() => (audioBlob ? URL.createObjectURL(audioBlob) : null), [audioBlob]);
  const busy = saveState !== "idle";

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

  async function handleSave() {
    if (!audioBlob) return;
    setSaveState("uploading");
    setUploadError(null);
    const result = await uploadAudio(pageId, audioBlob, "recording.webm", elapsedSeconds);
    if (!result.ok) {
      setSaveState("idle");
      setUploadError(result.error);
      return;
    }
    router.refresh();
    setSaveState("transcribing");
    const transcribed = await transcribePage(pageId);
    setSaveState("idle");
    if (!transcribed.ok) setUploadError(transcribed.error);
    reset();
    setLiveTranscript("");
    setExplanation(null);
    router.refresh();
  }

  const inSession = status === "recording" || status === "paused";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line/80 bg-surface p-6">
      <div className="flex flex-col items-center gap-3">
        <div className="font-mono text-3xl tabular-nums text-ink">{formatElapsed(elapsedSeconds)}</div>

        {status === "recording" && (
          <div className="h-2 w-48 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-red-500 transition-all"
              style={{ width: `${Math.min(100, level * 220)}%` }}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {status === "idle" && <Button onClick={startRecording}>Start recording</Button>}
          {status === "recording" && (
            <>
              <Button variant="secondary" onClick={pauseRecording}>
                Pause
              </Button>
              <Button variant="danger" onClick={stopRecording}>
                Stop
              </Button>
            </>
          )}
          {status === "paused" && (
            <>
              <Button onClick={resumeRecording}>Resume</Button>
              <Button variant="danger" onClick={stopRecording}>
                Stop
              </Button>
            </>
          )}
          {status === "stopped" && audioBlob && previewUrl && (
            <>
              <audio controls src={previewUrl} className="h-9" />
              <Button onClick={handleSave} disabled={busy}>
                {saveState === "uploading"
                  ? "Saving…"
                  : saveState === "transcribing"
                    ? "Transcribing…"
                    : "Save & transcribe"}
              </Button>
              <Button variant="secondary" onClick={reset} disabled={busy}>
                Discard
              </Button>
            </>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
      </div>

      {(inSession || (status === "stopped" && liveTranscript)) && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-2">
              Live transcript
              {liveBusy && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin text-brand" strokeWidth={2.5} />}
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
                  <Sparkles className="h-3.5 w-3.5 text-brand" strokeWidth={2.2} />
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
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-brand">Assistant</p>
              <p className="text-[13px] leading-6 text-ink-soft">{explanation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
