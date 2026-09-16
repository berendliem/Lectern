"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { useTasks } from "@/components/tasks/TaskProvider";
import clsx from "@/lib/clsx";

/**
 * Header readout for work started elsewhere in the app. A generation that
 * finishes — or fails — while the user is on another page is reported here,
 * because the component that started it may be long unmounted.
 */
export function TaskChip() {
  const { tasks, dismiss } = useTasks();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Every other popover in the shell closes on Escape or a click elsewhere;
  // this one stayed open until its own button was clicked again.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  if (tasks.length === 0) return null;

  const running = tasks.filter((task) => task.status === "running");
  const failed = tasks.filter((task) => task.status === "error");

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={clsx(
          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
          failed.length > 0
            ? "border-red-200 bg-red-50 text-red-700"
            : running.length > 0
              ? "border-brand-border bg-brand-soft/50 text-brand-ink"
              : "border-line bg-surface text-muted hover:border-line-strong"
        )}
        aria-label={running.length > 0 ? `${running.length} running` : "Background work"}
      >
        {running.length > 0 ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
            {running.length} running
          </>
        ) : failed.length > 0 ? (
          <>
            <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2.2} />
            {failed.length} failed
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
            Done
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-80 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <ul className="flex flex-col">
            {tasks.map((task) => (
              <li key={task.key} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <span className="mt-0.5">
                  {task.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-ink" strokeWidth={2.2} />
                  ) : task.status === "error" ? (
                    <TriangleAlert className="h-3.5 w-3.5 text-red-600" strokeWidth={2.2} />
                  ) : (
                    <Check className="h-3.5 w-3.5 text-moss-ink" strokeWidth={2.2} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {task.href ? (
                    <Link
                      href={task.href}
                      onClick={() => setOpen(false)}
                      className="text-[13px] font-medium text-ink-soft hover:text-brand-ink"
                    >
                      {task.label}
                    </Link>
                  ) : (
                    <p className="text-[13px] font-medium text-ink-soft">{task.label}</p>
                  )}
                  {task.progress.length > 0 && task.status === "running" && (
                    <p className="truncate text-[11.5px] text-muted-2">
                      {task.progress[task.progress.length - 1]}
                    </p>
                  )}
                  {task.error && <p className="text-[11.5px] text-red-600">{task.error}</p>}
                </div>
                {/* A running task is dismissable too: a stream whose response
                    stops arriving without closing never settles, and without
                    this the chip and the button that started it stay stuck for
                    the rest of the session. It stops tracking, nothing more. */}
                <button
                  onClick={() => dismiss(task.key)}
                  className="rounded p-0.5 text-muted-2 hover:bg-surface-3 hover:text-ink-soft"
                  aria-label={
                    task.status === "running"
                      ? `Stop tracking ${task.label}`
                      : `Dismiss ${task.label}`
                  }
                  title={
                    task.status === "running"
                      ? "Stop tracking this. The work already sent to the server keeps going and still saves its result."
                      : undefined
                  }
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
