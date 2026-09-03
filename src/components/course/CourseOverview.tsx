"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, ScrollText, Sparkles, TriangleAlert, Trash2 } from "lucide-react";
import clsx from "@/lib/clsx";
import { MASTERY_CLASSES, MASTERY_LABEL, type Mastery } from "@/lib/mastery";

export type TopicRow = {
  id: string;
  title: string;
  week: number | null;
  covered: boolean;
  matchTitle: string | null;
  matchHref: string | null;
  mastery: Mastery | null;
};

export function CourseOverview({
  folderId,
  topics,
  hasSyllabus,
  coverageAvailable,
}: {
  folderId: string;
  topics: TopicRow[];
  hasSyllabus: boolean;
  coverageAvailable: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const router = useRouter();

  async function send(key: string, url: string, init: RequestInit, failure: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? failure);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Network error talking to the local server.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function parseSyllabus() {
    const confirmed =
      topics.length === 0 ||
      window.confirm("Re-parsing replaces this course's topic list, including any edits. Continue?");
    if (!confirmed) return;
    await send(
      "parse",
      `/api/folders/${folderId}/parse-syllabus`,
      { method: "POST" },
      "Could not parse that syllabus."
    );
  }

  async function addTopic(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const ok = await send(
      "add",
      `/api/folders/${folderId}/topics`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
      "Could not add that topic."
    );
    if (ok) {
      setNewTitle("");
      setAdding(false);
    }
  }

  const covered = topics.filter((t) => t.covered).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-zinc-900">
            <ScrollText className="h-4 w-4 text-brand" strokeWidth={2.2} />
            Syllabus coverage
          </h2>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            {topics.length === 0
              ? "Parse the syllabus to see what this course is meant to cover."
              : `${covered} of ${topics.length} topics have a lecture or material behind them.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAdding((a) => !a)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.2} /> Topic
          </button>
          <button
            onClick={parseSyllabus}
            disabled={!hasSyllabus || busy !== null}
            title={hasSyllabus ? undefined : "Upload a syllabus to this course first"}
            className="inline-flex items-center gap-1.5 rounded-lg grad-brand px-3 py-2 text-[13px] font-medium text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
            {busy === "parse" ? "Parsing…" : topics.length > 0 ? "Re-parse syllabus" : "Parse syllabus"}
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}

      {!coverageAvailable && topics.length > 0 && (
        <p className="rounded-xl border border-zinc-200 bg-daisy-soft/50 px-4 py-3 text-[13px] text-zinc-700">
          Coverage is unavailable: nothing in this course is indexed for semantic search yet, or
          embedding failed. Topics are listed without a coverage verdict — none of them is being
          called uncovered.
        </p>
      )}

      {adding && (
        <form onSubmit={addTopic} className="flex gap-2">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Topic the syllabus covers"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft"
          />
          <button
            type="submit"
            disabled={!newTitle.trim() || busy !== null}
            className="rounded-lg grad-brand px-3.5 py-2 text-[13px] font-medium text-white shadow-brand disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      {topics.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-14 text-center text-sm text-zinc-400">
          No topics yet. Upload the syllabus as a material, then parse it — or add topics by hand.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {topics.map((topic) => (
            <li
              key={topic.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
            >
              <span
                className={clsx(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  topic.covered ? "bg-moss-soft text-moss-ink" : "bg-zinc-100 text-zinc-400"
                )}
                aria-hidden="true"
              >
                {topic.covered ? (
                  <Check className="h-4 w-4" strokeWidth={2.4} />
                ) : (
                  <TriangleAlert className="h-4 w-4" strokeWidth={2.2} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">
                  {topic.week !== null && (
                    <span className="mr-2 text-[12px] font-semibold uppercase tracking-wide text-zinc-400">
                      Week {topic.week}
                    </span>
                  )}
                  {topic.title}
                </p>
                <p className="truncate text-[12.5px] text-zinc-400">
                  {topic.covered && topic.matchTitle ? (
                    topic.matchHref ? (
                      <>
                        Covered by{" "}
                        <Link href={topic.matchHref} className="text-brand hover:underline">
                          {topic.matchTitle}
                        </Link>
                      </>
                    ) : (
                      `Covered by ${topic.matchTitle}`
                    )
                  ) : !coverageAvailable ? (
                    "Coverage not checked"
                  ) : topic.matchTitle ? (
                    `No lecture covers this — closest is ${topic.matchTitle}`
                  ) : (
                    "No lecture covers this yet"
                  )}
                </p>
              </div>
              {topic.mastery && (
                <span
                  className={clsx(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
                    MASTERY_CLASSES[topic.mastery]
                  )}
                >
                  {MASTERY_LABEL[topic.mastery]}
                </span>
              )}
              <button
                onClick={() =>
                  send(
                    topic.id,
                    `/api/topics/${topic.id}`,
                    { method: "DELETE" },
                    "Could not delete that topic."
                  )
                }
                disabled={busy === topic.id}
                aria-label={`Delete ${topic.title}`}
                className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
