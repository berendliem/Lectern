"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, ScrollText, Sparkles, TriangleAlert, Trash2 } from "lucide-react";
import clsx from "@/lib/clsx";
import { MASTERY_CLASSES, MASTERY_LABEL, type Mastery } from "@/lib/mastery";
import type { CoverageState } from "@/lib/coverage";
import { PretestDialog } from "@/components/course/PretestDialog";
import { LessonRunner } from "@/components/course/LessonRunner";

export type TopicRow = {
  id: string;
  title: string;
  week: number | null;
  covered: boolean;
  matchTitle: string | null;
  matchHref: string | null;
  mastery: Mastery | null;
};

export type OpenMisconception = {
  id: string;
  text: string;
  /** The lecture or material it was diagnosed against. */
  source: string | null;
};

export function CourseOverview({
  folderId,
  topics,
  hasSyllabus,
  coverage,
  misconceptions = [],
}: {
  folderId: string;
  topics: TopicRow[];
  hasSyllabus: boolean;
  coverage: CoverageState;
  misconceptions?: OpenMisconception[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [runningDialog, setRunningDialog] = useState<"pretest" | "lesson" | null>(null);
  const [debateOpen, setDebateOpen] = useState(false);
  const [debateSelect, setDebateSelect] = useState<string>("");
  const [debateSubmitting, setDebateSubmitting] = useState(false);
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

  async function startDebate() {
    if (!debateSelect) return;
    setDebateSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "COURSE_TOPIC", courseTopicId: debateSelect, mode: "DEBATE" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not start debate");
        setDebateSubmitting(false);
        return;
      }
      const { session } = await res.json();
      router.push(`/interview/${session.id}`);
    } catch {
      setError("Could not start debate");
      setDebateSubmitting(false);
    }
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
  const uncovered = topics.length - covered;
  const scored = coverage === "scored";
  const coverageSummary = !scored
    ? `${topics.length} topics, coverage not checked.`
    : uncovered === 0
      ? `All ${topics.length} topics have a lecture or material behind them.`
      : `${covered} of ${topics.length} topics covered — ${uncovered} still ${
          uncovered === 1 ? "has no lecture behind it" : "have no lecture behind them"
        }.`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <ScrollText className="h-4 w-4 text-brand-ink" strokeWidth={2.2} />
            Syllabus coverage
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {topics.length === 0
              ? "Parse the syllabus to see what this course is meant to cover."
              : "What this course is meant to cover, and what nothing has covered yet."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAdding((a) => !a)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.2} /> Topic
          </button>
          <button
            onClick={parseSyllabus}
            disabled={!hasSyllabus || busy !== null}
            title={hasSyllabus ? undefined : "Upload a syllabus to this course first"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-[13px] font-medium text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
            {busy === "parse" ? "Parsing…" : topics.length > 0 ? "Re-parse syllabus" : "Parse syllabus"}
          </button>
          {topics.length > 0 && (
            <>
              <button
                onClick={() => setDebateOpen(!debateOpen)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                Debate
              </button>
              {debateOpen && debateSelect && (
                <button
                  onClick={startDebate}
                  disabled={debateSubmitting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
                >
                  {debateSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
                  ) : null}
                  Start
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {topics.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Without a coverage verdict every segment would read as uncovered, which is
              an accusation the data doesn't support — so the strip waits for the verdict
              and the summary line carries the explanation on its own. */}
          {scored && (
            <div className="flex h-3 gap-px" role="img" aria-label={coverageSummary}>
              {topics.map((topic) => (
                <span
                  key={topic.id}
                  title={`${topic.title} — ${topic.covered ? "covered" : "not covered yet"}`}
                  className={clsx(
                    "min-w-[3px] flex-1 first:rounded-l-full last:rounded-r-full",
                    // Gold is only 2.2 : 1 against the parchment ground, so a gap
                    // segment carries a bronze rule to give it a 5.2 : 1 edge.
                    topic.covered ? "bg-brand" : "bg-gold ring-1 ring-inset ring-bronze"
                  )}
                />
              ))}
            </div>
          )}
          <p className="text-[13px] text-ink-soft">{coverageSummary}</p>
        </div>
      )}

      {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}

      {/* What this course got wrong and has not since got right. Each entry closes
          itself the next time the same lecture or card scores well, so the list is
          a to-do that empties on its own. */}
      {misconceptions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-2">
            Still getting this wrong
          </p>
          <ul className="flex flex-col gap-1.5 text-[13px] text-ink-soft">
            {misconceptions.map((m) => (
              <li key={m.id}>
                {m.text}
                {m.source && <span className="text-muted-2"> · {m.source}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!scored && topics.length > 0 && (
        <p className="rounded-xl border border-line bg-daisy-soft/50 px-4 py-3 text-[13px] text-ink-soft dark:bg-surface-3">
          {coverage === "no-sources"
            ? "Coverage has nothing to check against yet: this course has no indexed lecture or material other than the syllabus, and the syllabus can't cover itself. Import a lecture or upload course material, then this list gets a verdict."
            : "Coverage could not be checked: embedding the topics failed (see the server log). Topics are listed without a verdict — none of them is being called uncovered."}
        </p>
      )}

      {topics.length > 0 && debateOpen && (
        <div className="flex gap-2">
          <label htmlFor="debate-topic" className="text-[13px] font-medium text-ink-soft flex items-center">
            Choose a topic to debate:
          </label>
          <select
            id="debate-topic"
            value={debateSelect}
            onChange={(e) => setDebateSelect(e.target.value)}
            className="flex-1 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-gold"
          >
            <option value="">Select a topic...</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {adding && (
        <form onSubmit={addTopic} className="flex gap-2">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Topic the syllabus covers"
            className="flex-1 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <button
            type="submit"
            disabled={!newTitle.trim() || busy !== null}
            className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white shadow-brand disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      {topics.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong px-4 py-14 text-center text-sm text-muted-2">
          No topics yet. Upload the syllabus as a material, then parse it — or add topics by hand.
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {topics.map((topic) => (
              <li
                key={topic.id}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
              >
              <span
                className={clsx(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  topic.covered ? "bg-moss-soft text-moss-ink" : "bg-surface-3 text-muted-2"
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
                <p className="truncate text-sm font-medium text-ink">
                  {topic.week !== null && (
                    <span className="mr-2 text-[12px] font-semibold uppercase tracking-wide text-muted-2">
                      Week {topic.week}
                    </span>
                  )}
                  {topic.title}
                </p>
                <p className="truncate text-[12.5px] text-muted-2">
                  {topic.covered && topic.matchTitle ? (
                    topic.matchHref ? (
                      <>
                        Covered by{" "}
                        <Link href={topic.matchHref} className="text-brand-ink hover:underline">
                          {topic.matchTitle}
                        </Link>
                      </>
                    ) : (
                      `Covered by ${topic.matchTitle}`
                    )
                  ) : !scored ? (
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
              <div className="flex items-center gap-1">
                {!topic.covered ? (
                  <button
                    onClick={() => {
                      setSelectedTopicId(topic.id);
                      setRunningDialog("pretest");
                    }}
                    disabled={busy !== null}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft border border-line transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
                  >
                    Pretest
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setSelectedTopicId(topic.id);
                      setRunningDialog("lesson");
                    }}
                    disabled={busy !== null}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft border border-line transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
                  >
                    Recite
                  </button>
                )}
              </div>
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
                className="rounded-md p-1.5 text-muted-2 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </button>
              </li>
            ))}
          </ul>

          {selectedTopicId && runningDialog === "pretest" && (
            <PretestDialog
              open={runningDialog === "pretest"}
              onClose={() => {
                setRunningDialog(null);
                setSelectedTopicId(null);
              }}
              folderId={folderId}
              topicId={selectedTopicId}
            />
          )}

          {selectedTopicId && runningDialog === "lesson" && (
            <LessonRunner
              folderId={folderId}
              topicId={selectedTopicId}
              topicTitle={topics.find((t) => t.id === selectedTopicId)?.title ?? ""}
            />
          )}
        </>
      )}
    </div>
  );
}
