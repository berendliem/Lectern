"use client";

import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";
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

const STAGE_KEY = (pageId: string, stage: StageId) => `page:${pageId}:${stage}`;

export function PipelineStatusBanner({
  pageId,
  errorMessage,
  hasAudio,
  hasTranscript,
  hasNotes,
  hasFlashcards,
  hasQuiz,
}: Props) {
  const { run, task } = useTasks();
  const router = useRouter();

  const done: Record<StageId, boolean> = {
    transcribe: hasTranscript,
    summarize: hasNotes,
    "generate-flashcards": hasFlashcards,
    "generate-quiz": hasQuiz,
  };
  const remaining = STAGES.filter((stage) => !done[stage.id]);
  const allDone = remaining.length === 0;

  const stageTasks = STAGES.map((stage) => task(STAGE_KEY(pageId, stage.id)));
  const runningStage =
    STAGES.find((stage, i) => stageTasks[i]?.status === "running")?.id ?? null;
  const taskError = stageTasks.find((t) => t?.status === "error")?.error ?? null;

  async function runRemaining() {
    for (const stage of remaining) {
      let failed = false;
      await run(
        { key: STAGE_KEY(pageId, stage.id), label: stage.runningLabel, href: `/pages/${pageId}` },
        async () => {
          try {
            await postTask(
              `/api/pages/${pageId}/${stage.id}`,
              `${stage.label} generation failed. You can retry from here.`,
              undefined,
              "Lost connection to the local server mid-step. You can retry from here."
            );
          } catch (e) {
            failed = true;
            throw e;
          }
        }
      );
      router.refresh();
      // Later stages read what earlier ones wrote, so a failure stops the chain.
      if (failed) return;
    }
  }

  const message = taskError ?? errorMessage;
  const running = runningStage !== null;
  const runningInfo = STAGES.find((s) => s.id === runningStage);

  if (!hasAudio && !hasTranscript && !hasNotes) {
    return (
      <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        Record or upload lecture audio below — transcription starts automatically once it&apos;s saved.
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        allDone
          ? "border-moss bg-moss-soft/40"
          : message && !running
            ? "border-red-200 bg-red-50"
            : "border-line bg-surface"
      )}
    >
      <div className="flex flex-col gap-2">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
          {STAGES.map((stage, i) => {
            const isDone = done[stage.id];
            const isRunning = runningStage === stage.id;
            return (
              <li key={stage.id} className="flex items-center gap-1">
                {i > 0 && <span className="mx-1 h-px w-3.5 bg-line" aria-hidden="true" />}
                <span
                  className={clsx(
                    "flex items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 text-xs font-medium",
                    isDone
                      ? "bg-moss-soft text-moss-ink"
                      : isRunning
                        ? "bg-brand-soft text-brand-ink"
                        : "bg-surface-3 text-muted-2"
                  )}
                >
                  {isDone ? (
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  ) : isRunning ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" aria-hidden="true" />
                  )}
                  {stage.label}
                </span>
              </li>
            );
          })}
        </ol>
        {running && runningInfo && (
          <p className="text-xs text-brand-ink">{runningInfo.runningLabel}</p>
        )}
        {!running && message && <p className="text-xs font-medium text-red-700">{message}</p>}
        {!running && !message && allDone && (
          <p className="text-xs text-moss-ink">This page is ready to study.</p>
        )}
      </div>

      {!allDone && (
        <Button onClick={runRemaining} disabled={running} className="shrink-0 self-start sm:self-auto">
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
              Working…
            </>
          ) : message ? (
            "Retry"
          ) : (
            <>
              <Sparkles className="h-4 w-4" strokeWidth={2.2} />
              {remaining.length === STAGES.length - 1 && done.transcribe
                ? "Generate study materials"
                : remaining.length === STAGES.length
                  ? "Transcribe & generate"
                  : "Finish remaining steps"}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
