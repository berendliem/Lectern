"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMediaRecorder } from "@/components/recording/useMediaRecorder";
import { uploadAudio } from "@/components/recording/upload";
import { Button } from "@/components/ui/Button";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordingPanel({ pageId }: { pageId: string }) {
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
  } = useMediaRecorder();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const router = useRouter();
  const previewUrl = useMemo(() => (audioBlob ? URL.createObjectURL(audioBlob) : null), [audioBlob]);

  async function handleSave() {
    if (!audioBlob) return;
    setUploading(true);
    setUploadError(null);
    const result = await uploadAudio(pageId, audioBlob, "recording.webm", elapsedSeconds);
    setUploading(false);
    if (result.ok) {
      reset();
      router.refresh();
    } else {
      setUploadError(result.error);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white p-6">
      <div className="font-mono text-3xl tabular-nums text-slate-900">{formatElapsed(elapsedSeconds)}</div>

      {status === "recording" && (
        <div className="h-2 w-48 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-red-500 transition-all"
            style={{ width: `${Math.min(100, level * 220)}%` }}
          />
        </div>
      )}

      <div className="flex gap-2">
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
            <Button onClick={handleSave} disabled={uploading}>
              {uploading ? "Saving…" : "Save recording"}
            </Button>
            <Button variant="secondary" onClick={reset} disabled={uploading}>
              Discard
            </Button>
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
    </div>
  );
}
