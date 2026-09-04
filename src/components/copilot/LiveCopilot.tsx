"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Radio, Save, Square } from "lucide-react";
import { useRollingRecorder } from "@/components/copilot/useRollingRecorder";
import { TranscriptPanel } from "@/components/copilot/TranscriptPanel";
import { SuggestionsPanel } from "@/components/copilot/SuggestionsPanel";
import { SaveSessionModal } from "@/components/copilot/SaveSessionModal";
import { Button } from "@/components/ui/Button";
import { SUGGEST_EVERY_N_CLIPS } from "@/lib/copilot";
import type { CopilotSuggestion } from "@/lib/copilot";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function LiveCopilot() {
  const [transcript, setTranscript] = useState("");
  const [suggestion, setSuggestion] = useState<CopilotSuggestion | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const transcriptRef = useRef("");
  const clipsSinceSuggestRef = useRef(0);
  const suggestInFlightRef = useRef(false);
  const router = useRouter();

  const refreshSuggestions = useCallback(async () => {
    const text = transcriptRef.current.trim();
    if (!text || suggestInFlightRef.current) return;
    suggestInFlightRef.current = true;
    setSuggestLoading(true);
    try {
      const res = await fetch("/api/copilot/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuggestion(data as CopilotSuggestion);
        setSuggestError(null);
      } else {
        setSuggestError(data.error ?? "Could not update suggestions.");
      }
    } catch {
      setSuggestError("Network error talking to the local server.");
    } finally {
      suggestInFlightRef.current = false;
      setSuggestLoading(false);
    }
  }, []);

  const handleClip = useCallback(
    async (blob: Blob) => {
      const form = new FormData();
      form.append("file", blob, "clip.webm");
      try {
        const res = await fetch("/api/copilot/transcribe-chunk", { method: "POST", body: form });
        const data = await res.json();
        const text: string = typeof data.text === "string" ? data.text.trim() : "";
        if (text) {
          transcriptRef.current = `${transcriptRef.current} ${text}`.trim();
          setTranscript(transcriptRef.current);
          clipsSinceSuggestRef.current += 1;
          if (clipsSinceSuggestRef.current >= SUGGEST_EVERY_N_CLIPS) {
            clipsSinceSuggestRef.current = 0;
            void refreshSuggestions();
          }
        }
      } catch {
        // A dropped clip is non-fatal; the loop keeps going.
      }
    },
    [refreshSuggestions]
  );

  const recorder = useRollingRecorder(handleClip);
  const isRecording = recorder.status === "recording";

  // On stop, do a final suggestions refresh so the summary reflects everything.
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    if (wasRecordingRef.current && recorder.status === "stopped" && transcriptRef.current.trim()) {
      void refreshSuggestions();
    }
    wasRecordingRef.current = recorder.status === "recording";
  }, [recorder.status, refreshSuggestions]);

  async function handleSave(title: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/copilot/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, transcript: transcriptRef.current.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "Could not save.");
        setSaving(false);
        return;
      }
      router.push(`/pages/${data.pageId}`);
    } catch {
      setSaveError("Network error talking to the local server.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/80 bg-surface p-4">
        <div className="flex items-center gap-3">
          <span
            className={
              isRecording
                ? "flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-600"
                : "flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#7b3aff] to-[#5a14e8] text-white"
            }
          >
            <Radio className={isRecording ? "h-5 w-5 animate-pulse" : "h-5 w-5"} strokeWidth={2} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              {isRecording ? "Listening…" : "Live copilot"}
            </p>
            <p className="font-mono text-xs tabular-nums text-muted-2">{formatElapsed(recorder.elapsedSeconds)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRecording ? (
            <Button variant="danger" size="sm" onClick={recorder.stop}>
              <Square className="h-3.5 w-3.5" strokeWidth={2.5} />
              Stop
            </Button>
          ) : (
            <Button variant="brand" size="sm" onClick={recorder.start}>
              <Radio className="h-4 w-4" strokeWidth={2} />
              Start listening
            </Button>
          )}
          {transcript.trim() && (
            <Button variant="secondary" size="sm" onClick={() => setSaveOpen(true)}>
              <Save className="h-4 w-4" strokeWidth={2} />
              Save as lecture
            </Button>
          )}
        </div>
      </div>

      {recorder.error && <p className="text-[13px] font-medium text-red-700">{recorder.error}</p>}

      <div className="flex items-start gap-2 rounded-xl border border-sky-soft bg-sky-soft/40 px-3.5 py-2.5 text-[12.5px] text-sky-ink">
        <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
        <span>
          This runs openly on your screen — anyone you screen-share with can see it. Only capture audio you&apos;re allowed to
          record.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="min-h-[24rem] lg:h-[32rem]">
          <TranscriptPanel transcript={transcript} isRecording={isRecording} />
        </div>
        <SuggestionsPanel suggestion={suggestion} loading={suggestLoading} error={suggestError} />
      </div>

      <SaveSessionModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={handleSave}
        saving={saving}
        error={saveError}
      />
    </div>
  );
}
