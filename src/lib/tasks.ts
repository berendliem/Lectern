/**
 * The state machine behind TaskProvider. Kept free of React so the rules that
 * matter — one run per key, progress in order, a failure that sticks — are
 * testable without a renderer.
 */

export type TaskStatus = "running" | "done" | "error";

export type Task = {
  /** Identity, not a label: "page:<id>:summarize". Two clicks, one key, one run. */
  key: string;
  label: string;
  /** Where the user goes to watch it, when the task has a home. */
  href?: string;
  startedAt: number;
  status: TaskStatus;
  progress: string[];
  data?: unknown;
  error?: string;
};

export type TaskState = { tasks: Task[] };

export type TaskAction =
  | { type: "start"; key: string; label: string; href?: string; now: number }
  | { type: "step"; key: string; text: string }
  | { type: "emit"; key: string; data: unknown }
  | { type: "finish"; key: string }
  | { type: "fail"; key: string; message: string }
  | { type: "dismiss"; key: string }
  | { type: "clear"; keys: string[] };

export const EMPTY_TASKS: TaskState = { tasks: [] };

export function findTask(state: TaskState, key: string): Task | undefined {
  return state.tasks.find((task) => task.key === key);
}

export function isRunning(state: TaskState, key: string): boolean {
  return findTask(state, key)?.status === "running";
}

function mapTask(state: TaskState, key: string, update: (task: Task) => Task): TaskState {
  if (!findTask(state, key)) return state;
  return { tasks: state.tasks.map((task) => (task.key === key ? update(task) : task)) };
}

export function tasksReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case "start": {
      if (isRunning(state, action.key)) return state;
      const fresh: Task = {
        key: action.key,
        label: action.label,
        href: action.href,
        startedAt: action.now,
        status: "running",
        progress: [],
      };
      // A finished or failed run of the same key is replaced, not stacked:
      // the user is re-running that one thing.
      const others = state.tasks.filter((task) => task.key !== action.key);
      return { tasks: [...others, fresh] };
    }
    case "step":
      return mapTask(state, action.key, (task) => ({
        ...task,
        progress: [...task.progress, action.text],
      }));
    case "emit":
      return mapTask(state, action.key, (task) => ({ ...task, data: action.data }));
    case "finish":
      return mapTask(state, action.key, (task) => ({ ...task, status: "done" }));
    case "fail":
      return mapTask(state, action.key, (task) => ({
        ...task,
        status: "error",
        error: action.message,
      }));
    case "dismiss":
      return { tasks: state.tasks.filter((task) => task.key !== action.key) };
    case "clear": {
      // Drops the settled record of a key an action is about to run, so a
      // failure the user has already moved past stops shadowing what happens
      // next. A running task is never stale, so it is left alone.
      const keys = new Set(action.keys);
      const tasks = state.tasks.filter((task) => !keys.has(task.key) || task.status === "running");
      return tasks.length === state.tasks.length ? state : { tasks };
    }
  }
}

/**
 * POST a generation route and turn a non-2xx into a throw, so TaskProvider
 * records the server's own message as the task error.
 */
export async function postTask(
  url: string,
  fallback: string,
  init?: RequestInit,
  networkFallback?: string
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", ...init });
  } catch {
    throw new Error(networkFallback ?? fallback);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? fallback);
  return body;
}
