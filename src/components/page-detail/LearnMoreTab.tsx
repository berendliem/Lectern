"use client";

import { ArrowRight, Compass, Loader2, RefreshCw } from "lucide-react";
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";

type LearnMoreItem = { concept: string; why: string; nextStep: string };
type LearnMore = { items: LearnMoreItem[] };

export function LearnMoreTab({ pageId, hasMaterial }: { pageId: string; hasMaterial: boolean }) {
  const { run, task } = useTasks();
  const taskKey = `page:${pageId}:learn-more`;
  const learnTask = task(taskKey);
  const loading = learnTask?.status === "running";
  const learnMore = (learnTask?.data as LearnMore | undefined) ?? null;
  const error = learnTask?.error ?? null;

  async function generate() {
    await run(
      { key: taskKey, label: "Looking for what to learn next…", href: `/pages/${pageId}` },
      async ({ emit }) => {
        const body = (await postTask(
          `/api/pages/${pageId}/learn-more`,
          "Could not work out what to study next. Try again.",
          undefined,
          "Network error — please try again."
        )) as { learnMore?: LearnMore };
        // Emitting nothing would finish the task "done" while the tab shows its
        // empty state and no explanation — the failure has to be reported.
        if (!body.learnMore) throw new Error("Could not work out what to study next. Try again.");
        emit(body.learnMore);
      }
    );
  }

  if (!hasMaterial) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Compass className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink-soft">Nothing to build on yet</p>
          <p className="mt-1 text-[13px] text-muted-2">
            Transcribe the lecture first — then see which ideas it only gestured at.
          </p>
        </div>
      </div>
    );
  }

  if (!learnMore) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-line/80 bg-surface px-4 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Compass className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink-soft">Go one step past the lecture</p>
          <p className="mt-1 text-[13px] text-muted-2">
            AI names the ideas this lecture assumed or skimmed, and gives you one concrete move for
            each.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
          ) : (
            <Compass className="h-4 w-4" strokeWidth={2.2} />
          )}
          {loading ? "Finding threads…" : "Find what to learn next"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          Suggestions only — nothing here is a citation. Check each against your own course
          material.
        </p>
        <button
          onClick={generate}
          disabled={loading}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
          )}
          Regenerate
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <ul className="flex flex-col gap-2">
        {learnMore.items.map((item) => (
          <li key={item.concept} className="rounded-xl border border-line bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink-soft">{item.concept}</h3>
            <p className="mt-1 text-[13px] text-muted">{item.why}</p>
            <p className="mt-2 flex items-start gap-1.5 text-[13px] text-brand-ink">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              {item.nextStep}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
