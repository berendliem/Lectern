"use client";

import { useRouter } from "next/navigation";
import { Loader2, Target } from "lucide-react";
import { useTasks } from "@/components/tasks/TaskProvider";
import { Button } from "@/components/ui/Button";
import { postTask } from "@/lib/tasks";

/**
 * Writes fresh questions about the concepts this lecture has already been
 * failed on, and adds them to the quiz. Adds rather than replaces: a plain
 * regenerate drops the existing questions, and dropping a question takes its
 * attempt history with it — which is the very record this button reads.
 */
export function DrillMissesButton({ pageId, missedCount }: { pageId: string; missedCount: number }) {
  const router = useRouter();
  const { run, task, clear } = useTasks();
  const taskKey = `page:${pageId}:drill-misses`;
  const running = task(taskKey)?.status === "running";
  const error = task(taskKey)?.error ?? null;

  if (missedCount === 0) return null;

  async function drill() {
    clear([taskKey]);
    await run({ key: taskKey, label: "Writing drill questions…", href: `/pages/${pageId}` }, async () => {
      await postTask(
        `/api/pages/${pageId}/generate-quiz?misses=1`,
        "Could not write the drill questions. Try again.",
        undefined,
        "Could not reach Lectern. Check it is still running, then try again."
      );
    });
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
      {error && (
        <p role="alert" className="text-[13px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
