"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import clsx from "@/lib/clsx";

type Props = {
  pageId: string;
  errorMessage: string | null;
  hasAudio: boolean;
  hasTranscript: boolean;
  hasNotes: boolean;
  hasFlashcards: boolean;
  hasQuiz: boolean;
};

type StageId = "transcribe" | "summarize" | "generate-flashcards" | "generate-quiz";

const STAGES: { id: StageId; label: string; runningLabel: string }[] = [
  { id: "transcribe", label: "Transcript", runningLabel: "Transcribing audio…" },
  { id: "summarize", label: "Notes", runningLabel: "Summarizing into notes…" },
  { id: "generate-flashcards", label: "Flashcards", runningLabel: "Writing flashcards…" },
  { id: "generate-quiz", label: "Quiz", runningLabel: "Writing quiz questions…" },
];

export function PipelineStatusBanner({
  pageId,
  errorMessage,
  hasAudio,
  hasTranscript,
  hasNotes,
  hasFlashcards,
  hasQuiz,
}: Props) {
  const [runningStage, setRunningStage] = useState<StageId | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const router = useRouter();

  const done: Record<StageId, boolean> = {
    transcribe: hasTranscript,
    summarize: hasNotes,
    "generate-flashcards": hasFlashcards,
    "generate-quiz": hasQuiz,
  };
  const remaining = STAGES.filter((stage) => !done[stage.id]);
  const allDone = remaining.length === 0;

  async function runRemaining() {
    setLocalError(null);
    for (const stage of remaining) {
      setRunningStage(stage.id);
      try {
        const res = await fetch(`/api/pages/${pageId}/${stage.id}`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setLocalError(body.error ?? `${stage.label} generation failed. You can retry from here.`);
          setRunningStage(null);
          router.refresh();
          return;
        }
      } catch {
        setLocalError("Lost connection to the local server mid-step. You can retry from here.");
        setRunningStage(null);
        router.refresh();
        return;
      }
      router.refresh();
    }
    setRunningStage(null);
  }

  const message = localError ?? errorMessage;
  const running = runningStage !== null;
  const runningInfo = STAGES.find((s) => s.id === runningStage);

  if (!hasAudio && !hasTranscript && !hasNotes) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500">
        Record or upload lecture audio below — transcription starts automatically once it&apos;s saved.
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        allDone
          ? "border-emerald-200 bg-emerald-50"
          : message && !running
            ? "border-red-200 bg-red-50"
            : "border-zinc-200 bg-white"
      )}
    >
      <div className="flex flex-col gap-2">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
          {STAGES.map((stage, i) => {
            const isDone = done[stage.id];
            const isRunning = runningStage === stage.id;
            return (
              <li key={stage.id} className="flex items-center gap-1">
                {i > 0 && <span className="mx-1 h-px w-4 bg-zinc-300" aria-hidden="true" />}
                <span
                  className={clsx(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                    isDone
                      ? "bg-emerald-100 text-emerald-700"
                      : isRunning
                        ? "bg-brand-soft text-brand"
                        : "bg-zinc-100 text-zinc-400"
                  )}
                >
                  {isDone ? "✓" : isRunning ? <Spinner /> : "○"} {stage.label}
                </span>
              </li>
            );
          })}
        </ol>
        {running && runningInfo && (
          <p className="text-xs text-brand">{runningInfo.runningLabel}</p>
        )}
        {!running && message && <p className="text-xs font-medium text-red-700">{message}</p>}
        {!running && !message && allDone && (
          <p className="text-xs text-emerald-700">This page is ready to study.</p>
        )}
      </div>

      {!allDone && (
        <Button onClick={runRemaining} disabled={running} className="shrink-0 self-start sm:self-auto">
          {running
            ? "Working…"
            : message
              ? "Retry"
              : remaining.length === STAGES.length - 1 && done.transcribe
                ? "Generate study materials"
                : remaining.length === STAGES.length
                  ? "Transcribe & generate"
                  : "Finish remaining steps"}
        </Button>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent"
      aria-hidden="true"
    />
  );
}
