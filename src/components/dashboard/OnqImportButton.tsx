"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload, Loader2 } from "lucide-react";
import { useTasks } from "@/components/tasks/TaskProvider";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { OnqCourse } from "@/lib/mcp/onq-parse";
import {
  bestCourseMatch,
  defaultSelection,
  runImport,
  selectAllState,
  type AnnotatedModule,
  type ImportOutcome,
  type ImportSummary,
  type ImportTarget,
  type TopicStatus,
} from "@/lib/onq-import";
import { postTask } from "@/lib/tasks";

const STATUS_NOTE: Record<TopicStatus, string | null> = {
  new: null,
  imported: "Already imported",
  changed: "Changed on onQ",
  unavailable: "Can't import",
};

const UNREACHABLE = "Could not reach Lectern. Check it is still running, then try again.";

type View =
  | { step: "loading" }
  | { step: "link"; courses: OnqCourse[]; courseId: number | null }
  | { step: "pick"; modules: AnnotatedModule[]; selected: Set<number> };

async function getJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(url);
    const body: { error?: string } = await res.json().catch(() => ({}));
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        error:
          body.error ??
          (res.status >= 500
            ? "Lectern hit an error handling that request. Check its terminal output."
            : "Could not reach onQ. Check Lectern's mcp.config.json, then try again."),
      };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: UNREACHABLE };
  }
}

function summaryLine(summary: ImportSummary): string {
  const parts: string[] = [];
  if (summary.imported) parts.push(`${summary.imported} imported`);
  if (summary.updated) parts.push(`${summary.updated} updated`);
  if (summary.skipped.length) parts.push(`${summary.skipped.length} skipped`);
  return parts.length ? parts.join(", ") : "Nothing was imported";
}

export function OnqImportButton({ folderId, folderName }: { folderId: string; folderName: string }) {
  const router = useRouter();
  const { run, task, clear } = useTasks();
  const taskKey = `folder:${folderId}:onq-import`;
  const current = task(taskKey);
  const running = current?.status === "running";
  const summary =
    current?.status === "done" || current?.status === "error"
      ? (current.data as ImportSummary | undefined)
      : undefined;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ step: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const requestIdRef = useRef(0);

  async function loadCourses() {
    const requestId = ++requestIdRef.current;
    setError(null);
    setView({ step: "loading" });
    const list = await getJson<{ courses: OnqCourse[] }>("/api/onq/courses");
    if (requestId !== requestIdRef.current) return;
    if (!list.ok) {
      setError(list.error);
      return;
    }
    setView({ step: "link", courses: list.data.courses, courseId: bestCourseMatch(folderName, list.data.courses) });
  }

  async function loadTree() {
    const requestId = ++requestIdRef.current;
    setError(null);
    setView({ step: "loading" });
    const tree = await getJson<{ modules: AnnotatedModule[] }>(`/api/folders/${folderId}/onq`);
    if (requestId !== requestIdRef.current) return;
    if (tree.ok) {
      setView({ step: "pick", modules: tree.data.modules, selected: new Set(defaultSelection(tree.data.modules)) });
      return;
    }
    // 409 is "not linked yet" — the one failure with a next step inside this dialog.
    if (tree.status === 409) {
      await loadCourses();
      return;
    }
    setError(tree.error);
  }

  async function link(courseId: number) {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onqCourseId: courseId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not link that course. Try again.");
        return;
      }
      await loadTree();
    } catch {
      setError(UNREACHABLE);
    } finally {
      setLinking(false);
    }
  }

  function toggle(topicId: number) {
    setView((v) => {
      if (v.step !== "pick") return v;
      const selected = new Set(v.selected);
      if (!selected.delete(topicId)) selected.add(topicId);
      return { ...v, selected };
    });
  }

  /** Ticking adds the new and changed files; unticking clears every tick, so one file is two clicks away. */
  function setAll(on: boolean) {
    setView((v) => {
      if (v.step !== "pick") return v;
      return { ...v, selected: on ? new Set([...v.selected, ...defaultSelection(v.modules)]) : new Set<number>() };
    });
  }

  const defaults = view.step === "pick" ? defaultSelection(view.modules) : [];
  const allState = view.step === "pick" ? selectAllState(view.selected, defaults) : "none";

  async function startImport(modules: AnnotatedModule[], selected: Set<number>) {
    const targets: ImportTarget[] = modules.flatMap((m) =>
      m.topics
        .filter((t) => selected.has(t.topicId))
        .map((t) => ({ topicId: t.topicId, title: t.title, moduleTitle: m.title }))
    );
    setOpen(false);
    clear([taskKey]);
    await run(
      { key: taskKey, label: `Importing ${targets.length} from onQ…`, href: `/folders/${folderId}` },
      async ({ step, emit }) => {
        const result = await runImport(
          targets,
          (target) =>
            postTask(
              `/api/folders/${folderId}/onq/import`,
              "That file could not be imported.",
              {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topicId: target.topicId, moduleTitle: target.moduleTitle }),
              },
              UNREACHABLE
            ) as Promise<ImportOutcome>,
          step
        );
        emit(result);
        // Whatever landed before the session died is saved (the summary below shows it);
        // the thrown error only needs to say why it stopped.
        if (result.aborted) throw new Error(`onQ stopped answering before the import finished. ${result.aborted}`);
      }
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="secondary"
        disabled={running}
        onClick={() => {
          setOpen(true);
          void loadTree();
        }}
      >
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <CloudDownload className="h-4 w-4" strokeWidth={2} />
        )}
        {running ? "Importing from onQ…" : "Import from onQ"}
      </Button>

      {current?.status === "error" && (
        <p role="alert" className="max-w-sm text-right text-[13px] text-red-600">
          {current.error}
        </p>
      )}
      {summary && (
        <div className="max-w-sm text-right text-[13px] text-muted-2">
          <p>{summaryLine(summary)}.</p>
          {summary.skipped.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {summary.skipped.map((s) => (
                <li key={s.topicId}>
                  {s.title}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Import from onQ">
        <div className="flex flex-col gap-3">
          {error && (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-[13px] text-red-600">
                {error}
              </p>
              {view.step !== "link" && (
                <button type="button" className="text-[13px] text-muted-2 underline" onClick={() => void loadCourses()}>
                  Wrong onQ course?
                </button>
              )}
            </div>
          )}

          {!error && view.step === "loading" && (
            <p role="status" aria-live="polite" className="flex items-center gap-2 text-[13px] text-muted-2">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Asking onQ…
            </p>
          )}

          {!error && view.step === "link" && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (view.courseId !== null) void link(view.courseId);
              }}
            >
              <label className="flex flex-col gap-1.5 text-[13px]">
                Which onQ course is {folderName}?
                <select
                  className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-[14px]"
                  value={view.courseId ?? ""}
                  onChange={(e) => {
                    const courseId = e.target.value ? Number(e.target.value) : null;
                    setView((v) => (v.step === "link" ? { ...v, courseId } : v));
                  }}
                >
                  <option value="">Choose a course</option>
                  {view.courses.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={view.courseId === null || linking} className="self-end">
                {linking ? "Linking…" : "Link course"}
              </Button>
            </form>
          )}

          {!error && view.step === "pick" && (
            <>
              {defaults.length > 0 && (
                <label className="flex items-baseline gap-2 text-[14px] font-medium">
                  <input
                    type="checkbox"
                    checked={allState === "all"}
                    ref={(el) => {
                      if (el) el.indeterminate = allState === "some";
                    }}
                    onChange={() => setAll(allState !== "all")}
                  />
                  All new and changed ({defaults.length})
                </label>
              )}
              <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
                {view.modules
                  .filter((m) => m.topics.length > 0)
                  .map((m) => (
                    <fieldset key={m.moduleId} className="flex flex-col gap-1">
                      <legend className="text-[12.5px] font-medium text-muted-2">{m.title}</legend>
                      {m.topics.map((t) => (
                        <label
                          key={t.topicId}
                          className={`flex items-baseline gap-2 text-[14px] ${
                            t.status === "unavailable" ? "text-muted-2" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={view.selected.has(t.topicId)}
                            disabled={t.status === "unavailable"}
                            onChange={() => toggle(t.topicId)}
                          />
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          <span className="shrink-0 text-[12px] text-muted-2">
                            {[t.extension?.toUpperCase(), STATUS_NOTE[t.status]].filter(Boolean).join(" · ")}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="text-[13px] text-muted-2 underline" onClick={() => void loadCourses()}>
                  Wrong onQ course?
                </button>
                <Button
                  disabled={view.selected.size === 0}
                  onClick={() => void startImport(view.modules, view.selected)}
                >
                  Import {view.selected.size} {view.selected.size === 1 ? "file" : "files"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
