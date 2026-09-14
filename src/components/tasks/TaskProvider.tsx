"use client";

import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import { EMPTY_TASKS, findTask, tasksReducer, type Task } from "@/lib/tasks";

export type TaskSpec = { key: string; label: string; href?: string };
export type TaskIO = { step(text: string): void; emit(data: unknown): void };

/**
 * What `run()` hands back. `ran: false` means the key was already in flight, so
 * this caller awaited someone else's run and its own `fn` never executed. A
 * caller whose next step depends on the work having actually happened — upload
 * the audio, then transcribe it — has to be able to tell those apart.
 */
export type TaskOutcome = { ran: boolean; status: "done" | "error"; error?: string };

type TaskContextValue = {
  tasks: Task[];
  task(key: string): Task | undefined;
  run(spec: TaskSpec, fn: (io: TaskIO) => Promise<void>): Promise<TaskOutcome>;
  dismiss(key: string): void;
  /** Forget settled tasks for these keys; running ones are left alone. */
  clear(keys: string[]): void;
};

const TaskContext = createContext<TaskContextValue | null>(null);

/**
 * Holds long-running work above the router, so switching tabs or navigating
 * away loses the spinner's owner but not the spinner.
 */
export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(tasksReducer, EMPTY_TASKS);
  // The reducer knows a key is running; only this map can hand back the actual
  // promise, so a second caller awaits the first run instead of starting one.
  const inFlight = useRef(new Map<string, Promise<TaskOutcome>>());

  const run = useCallback(
    async (spec: TaskSpec, fn: (io: TaskIO) => Promise<void>): Promise<TaskOutcome> => {
      const existing = inFlight.current.get(spec.key);
      // A deduped caller gets the other run's outcome, flagged as not its own:
      // awaiting someone else's work is not the same as having done the work.
      if (existing) return { ...(await existing), ran: false };

      dispatch({ type: "start", key: spec.key, label: spec.label, href: spec.href, now: Date.now() });

      // The holder lets the `finally` below check that the entry it is about to
      // drop is still its own: a run the user dismissed while it hung must not
      // delete the retry that replaced it when it finally settles.
      const holder: { promise?: Promise<TaskOutcome> } = {};
      holder.promise = (async (): Promise<TaskOutcome> => {
        try {
          await fn({
            step: (text) => dispatch({ type: "step", key: spec.key, text }),
            emit: (data) => dispatch({ type: "emit", key: spec.key, data }),
          });
          dispatch({ type: "finish", key: spec.key });
          return { ran: true, status: "done" };
        } catch (e) {
          const message = e instanceof Error ? e.message : "That step failed. You can retry it.";
          dispatch({ type: "fail", key: spec.key, message });
          return { ran: true, status: "error", error: message };
        } finally {
          if (inFlight.current.get(spec.key) === holder.promise) inFlight.current.delete(spec.key);
        }
      })();

      inFlight.current.set(spec.key, holder.promise);
      return holder.promise;
    },
    []
  );

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks: state.tasks,
      task: (key: string) => findTask(state, key),
      run,
      dismiss: (key: string) => {
        // Dismissing a task that never settles has to release the dedupe entry
        // too, or the retry would silently await the same wedged promise.
        inFlight.current.delete(key);
        dispatch({ type: "dismiss", key });
      },
      clear: (keys: string[]) => dispatch({ type: "clear", keys }),
    }),
    [state, run]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks(): TaskContextValue {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTasks must be used inside <TaskProvider>");
  return ctx;
}

export function useTask(key: string): Task | undefined {
  return useTasks().task(key);
}
