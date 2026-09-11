"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CalendarClock, Loader2 } from "lucide-react";
import type { AgentEvent } from "@/lib/agent/stream";
import { useTasks } from "@/components/tasks/TaskProvider";

type PanelEvent = AgentEvent | { type: "error"; message: string };

export function StudyPlanPanel({ folderId }: { folderId: string }) {
  const { run, task } = useTasks();
  const taskKey = `folder:${folderId}:study-plan`;
  const planTask = task(taskKey);
  const running = planTask?.status === "running";
  const steps = planTask?.progress ?? [];
  const plan = (planTask?.data as string | undefined) ?? null;
  const error = planTask?.error ?? null;

  async function start() {
    await run(
      { key: taskKey, label: "Planning this week's study…", href: `/folders/${folderId}` },
      async ({ step, emit }) => {
        const res = await fetch(`/api/folders/${folderId}/study-plan`, { method: "POST" });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Could not start the study-plan run");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let failure: string | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // The last piece may be half a line; keep it for the next chunk.
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as PanelEvent;
            if (event.type === "tool") step(event.name.replace(/_/g, " "));
            else if (event.type === "result") emit(event.text);
            else if (event.type === "error") failure = event.message;
          }
        }
        // The route sends failures as events on an already-200 response.
        if (failure) throw new Error(failure);
      }
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <CalendarClock className="h-4 w-4 text-brand-ink" strokeWidth={2.2} />
            Study plan
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">
            Reads this course&apos;s lectures, coverage and due cards, then plans the week.
          </p>
        </div>
        <button
          onClick={start}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-[13px] font-medium text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> : null}
          {running ? "Planning…" : plan ? "Plan again" : "Plan my week"}
        </button>
      </div>

      {steps.length > 0 && !plan && (
        <ul className="flex flex-col gap-1 text-[13px] text-muted">
          {steps.map((step, i) => (
            <li key={`${step}-${i}`}>· {step}</li>
          ))}
        </ul>
      )}

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {plan && (
        <div className="prose prose-sm max-w-none text-ink dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
