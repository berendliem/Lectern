import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TASKS, findTask, isRunning, tasksReducer, type TaskState } from "@/lib/tasks";

function started(key = "page:p1:summarize"): TaskState {
  return tasksReducer(EMPTY_TASKS, {
    type: "start",
    key,
    label: "Summarizing into notes…",
    href: "/pages/p1",
    now: 1_000,
  });
}

test("start records a running task", () => {
  const state = started();
  assert.equal(state.tasks.length, 1);
  const task = findTask(state, "page:p1:summarize");
  assert.equal(task?.status, "running");
  assert.equal(task?.label, "Summarizing into notes…");
  assert.equal(task?.href, "/pages/p1");
  assert.equal(task?.startedAt, 1_000);
  assert.deepEqual(task?.progress, []);
  assert.equal(isRunning(state, "page:p1:summarize"), true);
  assert.equal(isRunning(state, "page:p1:quiz"), false);
});

test("starting a key that is already running changes nothing", () => {
  const state = started();
  const again = tasksReducer(state, {
    type: "start",
    key: "page:p1:summarize",
    label: "A second click",
    now: 2_000,
  });
  assert.equal(again, state);
});

test("starting a finished key replaces it with a fresh run", () => {
  const done = tasksReducer(
    tasksReducer(started(), { type: "step", key: "page:p1:summarize", text: "read transcript" }),
    { type: "finish", key: "page:p1:summarize" }
  );
  const restarted = tasksReducer(done, {
    type: "start",
    key: "page:p1:summarize",
    label: "Summarizing into notes…",
    now: 3_000,
  });
  assert.equal(restarted.tasks.length, 1);
  const task = findTask(restarted, "page:p1:summarize");
  assert.equal(task?.status, "running");
  assert.equal(task?.startedAt, 3_000);
  assert.deepEqual(task?.progress, []);
  assert.equal(task?.error, undefined);
  assert.equal(task?.data, undefined);
});

test("step appends progress in order and emit attaches data", () => {
  let state = started("folder:f1:study-plan");
  state = tasksReducer(state, { type: "step", key: "folder:f1:study-plan", text: "list lectures" });
  state = tasksReducer(state, { type: "step", key: "folder:f1:study-plan", text: "score topics" });
  state = tasksReducer(state, { type: "emit", key: "folder:f1:study-plan", data: "## Week plan" });
  const task = findTask(state, "folder:f1:study-plan");
  assert.deepEqual(task?.progress, ["list lectures", "score topics"]);
  assert.equal(task?.data, "## Week plan");
  assert.equal(task?.status, "running");
});

test("fail records the message and stops running", () => {
  const state = tasksReducer(started(), {
    type: "fail",
    key: "page:p1:summarize",
    message: "The model returned nothing usable.",
  });
  const task = findTask(state, "page:p1:summarize");
  assert.equal(task?.status, "error");
  assert.equal(task?.error, "The model returned nothing usable.");
  assert.equal(isRunning(state, "page:p1:summarize"), false);
});

test("finish keeps the task and its data for the renderer", () => {
  const state = tasksReducer(
    tasksReducer(started(), { type: "emit", key: "page:p1:summarize", data: { items: 3 } }),
    { type: "finish", key: "page:p1:summarize" }
  );
  const task = findTask(state, "page:p1:summarize");
  assert.equal(task?.status, "done");
  assert.deepEqual(task?.data, { items: 3 });
});

test("dismiss drops the task", () => {
  const state = tasksReducer(started(), { type: "dismiss", key: "page:p1:summarize" });
  assert.deepEqual(state.tasks, []);
});

test("clear drops a failed task so it stops shadowing the next attempt", () => {
  const failed = tasksReducer(started(), {
    type: "fail",
    key: "page:p1:summarize",
    message: "The model returned nothing usable.",
  });
  const cleared = tasksReducer(failed, { type: "clear", keys: ["page:p1:summarize"] });
  assert.deepEqual(cleared.tasks, []);
});

test("clear drops finished tasks and keeps running ones", () => {
  let state = started("page:p1:transcribe");
  state = tasksReducer(state, { type: "finish", key: "page:p1:transcribe" });
  state = tasksReducer(state, {
    type: "start",
    key: "page:p1:summarize",
    label: "Summarizing into notes…",
    now: 2_000,
  });
  const cleared = tasksReducer(state, {
    type: "clear",
    keys: ["page:p1:transcribe", "page:p1:summarize"],
  });
  assert.equal(findTask(cleared, "page:p1:transcribe"), undefined);
  assert.equal(findTask(cleared, "page:p1:summarize")?.status, "running");
});

test("clear leaves the state identical when it matches nothing", () => {
  const state = started();
  assert.equal(tasksReducer(state, { type: "clear", keys: [] }), state);
  assert.equal(tasksReducer(state, { type: "clear", keys: ["page:p1:quiz"] }), state);
});

test("a failed key restarted by a retry reports running, not the old error", () => {
  const failed = tasksReducer(started(), {
    type: "fail",
    key: "page:p1:summarize",
    message: "Lost connection to the local server mid-step.",
  });
  const retried = tasksReducer(failed, {
    type: "start",
    key: "page:p1:summarize",
    label: "Summarizing into notes…",
    now: 4_000,
  });
  const task = findTask(retried, "page:p1:summarize");
  assert.equal(task?.status, "running");
  assert.equal(task?.error, undefined);
});

test("actions for an unknown key are ignored", () => {
  const state = started();
  assert.equal(tasksReducer(state, { type: "step", key: "nope", text: "x" }), state);
  assert.equal(tasksReducer(state, { type: "finish", key: "nope" }), state);
});
