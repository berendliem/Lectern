"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CalendarClock, Loader2 } from "lucide-react";
import type { AgentEvent } from "@/lib/agent/stream";

type PanelEvent = AgentEvent | { type: "error"; message: string };

export function StudyPlanPanel({ folderId }: { folderId: string }) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [plan, setPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function run() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setSteps([]);
    setPlan(null);
    setError(null);

    try {
      const res = await fetch(`/api/folders/${folderId}/study-plan`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not start the study-plan run");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          if (event.type === "tool") setSteps((s) => [...s, event.name.replace(/_/g, " ")]);
          else if (event.type === "result") setPlan(event.text);
          else if (event.type === "error") setError(event.message);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "The study-plan run failed");
      }
    } finally {
      setRunning(false);
    }
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
          onClick={run}
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
