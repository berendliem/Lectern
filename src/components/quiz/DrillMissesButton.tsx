"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Target } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Writes fresh questions about the concepts this lecture has already been
 * failed on, and adds them to the quiz. Adds rather than replaces: a plain
 * regenerate drops the existing questions, and dropping a question takes its
 * attempt history with it — which is the very record this button reads.
 */
export function DrillMissesButton({ pageId, missedCount }: { pageId: string; missedCount: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (missedCount === 0) return null;

  async function drill() {
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/pages/${pageId}/generate-quiz?misses=1`, { method: "POST" });
    setRunning(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not write the drill questions. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="secondary" size="sm" onClick={drill} disabled={running} className="self-start">
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <Target className="h-4 w-4" strokeWidth={2} />
        )}
        {running ? "Writing drill questions…" : `Drill my misses (${missedCount})`}
      </Button>
      <p className="text-[13px] text-muted-2">
        Adds new questions on the {missedCount === 1 ? "concept" : "concepts"} you got wrong. Nothing existing is
        removed.
      </p>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
    </div>
  );
}
