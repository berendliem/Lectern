"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { PageStatus } from "@/generated/prisma/enums";

type Props = {
  pageId: string;
  status: PageStatus;
  errorMessage: string | null;
  hasAudio: boolean;
  hasTranscript: boolean;
  hasNotes: boolean;
  hasGuide: boolean;
};

type Stage = "transcribe" | "summarize" | "guide";

const STAGE_ENDPOINT: Record<Stage, string> = {
  transcribe: "transcribe",
  summarize: "summarize",
  guide: "generate-flashcards",
};

export function PipelineStatusBanner({
  pageId,
  status,
  errorMessage,
  hasAudio,
  hasTranscript,
  hasNotes,
  hasGuide,
}: Props) {
  const [loading, setLoading] = useState<Stage | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const router = useRouter();

  async function runStage(stage: Stage) {
    setLoading(stage);
    setLocalError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/${STAGE_ENDPOINT[stage]}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLocalError(body.error ?? "Something went wrong. You can retry this step.");
      } else if (stage === "guide") {
        // flashcards and quiz are generated as two separate, independently-retriable calls
        const quizRes = await fetch(`/api/pages/${pageId}/generate-quiz`, { method: "POST" });
        if (!quizRes.ok) {
          const body = await quizRes.json().catch(() => ({}));
          setLocalError(body.error ?? "Quiz generation failed. You can retry this step.");
        }
      }
    } catch {
      setLocalError("Network error talking to the local server. Is it still running?");
    } finally {
      setLoading(null);
      router.refresh();
    }
  }

  const message = localError ?? errorMessage;

  if (status === "READY" && !message) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
        This page is ready to study.
      </div>
    );
  }

  if (!hasAudio) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
        Record or upload audio in the Transcript tab to get started.
      </div>
    );
  }

  let stage: Stage | null = null;
  let cta = "";
  if (!hasTranscript) {
    stage = "transcribe";
    cta = "Transcribe audio";
  } else if (!hasNotes) {
    stage = "summarize";
    cta = "Generate notes";
  } else if (!hasGuide) {
    stage = "guide";
    cta = "Generate flashcards & quiz";
  }

  if (!stage) return null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
      <p className="text-sm text-amber-800">
        {message ? <span className="font-medium text-red-700">{message}</span> : `Next step: ${cta.toLowerCase()}.`}
      </p>
      <Button size="sm" onClick={() => runStage(stage!)} disabled={loading !== null}>
        {loading === stage ? "Working…" : message ? `Retry: ${cta}` : cta}
      </Button>
    </div>
  );
}
