"use client";

import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import { EMPTY_TASKS, findTask, tasksReducer, type Task } from "@/lib/tasks";

export type TaskSpec = { key: string; label: string; href?: string };
export type TaskIO = { step(text: string): void; emit(data: unknown): void };

type TaskContextValue = {
  tasks: Task[];
  task(key: string): Task | undefined;
  run(spec: TaskSpec, fn: (io: TaskIO) => Promise<void>): Promise<void>;
  dismiss(key: string): void;
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
  const inFlight = useRef(new Map<string, Promise<void>>());

  const run = useCallback(async (spec: TaskSpec, fn: (io: TaskIO) => Promise<void>) => {
    const existing = inFlight.current.get(spec.key);
    if (existing) return existing;

    dispatch({ type: "start", key: spec.key, label: spec.label, href: spec.href, now: Date.now() });

    const promise = (async () => {
      try {
        await fn({
          step: (text) => dispatch({ type: "step", key: spec.key, text }),
          emit: (data) => dispatch({ type: "emit", key: spec.key, data }),
        });
        dispatch({ type: "finish", key: spec.key });
      } catch (e) {
        dispatch({
          type: "fail",
          key: spec.key,
          message: e instanceof Error ? e.message : "That step failed. You can retry it.",
        });
      } finally {
        inFlight.current.delete(spec.key);
      }
    })();

    inFlight.current.set(spec.key, promise);
    return promise;
  }, []);

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks: state.tasks,
      task: (key: string) => findTask(state, key),
      run,
      dismiss: (key: string) => dispatch({ type: "dismiss", key }),
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
