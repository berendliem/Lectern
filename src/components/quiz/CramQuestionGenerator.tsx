"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";

/**
 * Fills in quiz questions for the course's materials that have none, so a
 * course with slides and readings but no lecture can still be crammed.
 *
 * One material at a time, under the same task key the Materials tab uses: a
 * free model rate-limits a burst, and a shared key means the per-material
 * button shows the run in progress instead of starting a second one.
 */
export function CramQuestionGenerator({
  folderId,
  materials,
  restartsRun,
}: {
  folderId: string;
  materials: { id: string; title: string }[];
  /** A run is already on screen, and the refresh that brings in new questions resets it. */
  restartsRun: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<{ title: string; error: string }[]>([]);
  const router = useRouter();
  const { run } = useTasks();

  async function generateAll() {
    setWorking(true);
    setFailed([]);
    const failures: { title: string; error: string }[] = [];
    for (const material of materials) {
      const outcome = await run(
        {
          key: `material:${material.id}:quiz`,
          label: `Generating quiz from "${material.title}"…`,
          href: `/folders/${folderId}/cram`,
        },
        async () => {
          // `ifEmpty` because this page may be stale: a material that got its
          // questions since it rendered must keep them, and the attempts on them.
          await postTask(
            `/api/materials/${material.id}/generate-quiz?ifEmpty=1`,
            "Could not generate quiz from that material.",
            undefined,
            "Network error talking to the local server."
          );
        }
      );
      // The server's reason, not a blanket "retry": a material with nothing
      // to generate from fails the same way every time.
      if (outcome.status === "error") {
        failures.push({ title: material.title, error: outcome.error ?? "Could not generate a quiz." });
      }
    }
    setFailed(failures);
    setWorking(false);
    router.refresh();
  }

  const count = materials.length;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          {count} material{count === 1 ? " has" : "s have"} no quiz questions yet.
          {restartsRun && " Generating restarts this run with them mixed in."}
        </p>
        <button
          onClick={generateAll}
          disabled={working}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" strokeWidth={2} />
          {working ? "Generating…" : `Generate questions from ${count} material${count === 1 ? "" : "s"}`}
        </button>
      </div>
      {failed.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-[12.5px] font-medium text-red-700">
          {failed.map((f) => (
            <li key={f.title}>
              {f.title}: {f.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
