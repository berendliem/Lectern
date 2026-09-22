/**
 * The rules of an onQ import, free of the database, the MCP client and React
 * so they can be tested directly: what kind a file probably is, which topics
 * are new, what becomes a material, and how a batch proceeds.
 */
import type { MaterialKind } from "./drop-intake.ts";
import type { OnqCourse, OnqModule, OnqTopic, OnqTopicText } from "./mcp/onq-parse.ts";

export type TopicStatus = "new" | "imported" | "changed" | "unavailable";
export type AnnotatedTopic = OnqTopic & { status: TopicStatus };
export type AnnotatedModule = { moduleId: number; title: string; topics: AnnotatedTopic[] };
export type ImportedRef = { onqTopicId: number | null; onqLastModified: string | null };
export type MaterialDraft = {
  kind: MaterialKind;
  title: string;
  text: string;
  sourceFileName: string | null;
  onqTopicId: number;
  onqLastModified: string | null;
};
export type ImportTarget = { topicId: number; title: string; moduleTitle: string };
export type ImportOutcome = { outcome: "imported" | "updated" | "skipped"; reason?: string };
export type ImportSummary = {
  imported: number;
  updated: number;
  skipped: { topicId: number; title: string; reason: string }[];
  aborted: string | null;
};

const SYLLABUS_RE = /syllabus|course outline/i;
const SLIDE_EXTENSIONS = new Set(["pptx", "ppt", "key"]);

/** A starting guess only — the kind stays editable on the material afterwards. */
export function guessKind(extension: string | null, title: string, moduleTitle: string): MaterialKind {
  // Title first: a syllabus handed out as a deck is still the syllabus, and
  // that is the one kind the rest of the app treats specially.
  if (SYLLABUS_RE.test(title) || SYLLABUS_RE.test(moduleTitle)) return "SYLLABUS";
  if (extension && SLIDE_EXTENSIONS.has(extension)) return "SLIDES";
  return "READING";
}

export function annotateTree(modules: OnqModule[], existing: ImportedRef[]): AnnotatedModule[] {
  const imported = new Map<number, string | null>();
  for (const ref of existing) {
    if (ref.onqTopicId !== null) imported.set(ref.onqTopicId, ref.onqLastModified);
  }

  const statusOf = (topic: OnqTopic): TopicStatus => {
    if (!topic.downloadable) return "unavailable";
    if (!imported.has(topic.topicId)) return "new";
    // No date from onQ is no evidence of a change; only a differing date is.
    if (topic.lastModified !== null && imported.get(topic.topicId) !== topic.lastModified) return "changed";
    return "imported";
  };

  return modules.map((m) => ({
    moduleId: m.moduleId,
    title: m.title,
    topics: m.topics.map((t) => ({ ...t, status: statusOf(t) })),
  }));
}

export function defaultSelection(modules: AnnotatedModule[]): number[] {
  return modules.flatMap((m) =>
    m.topics.filter((t) => t.status === "new" || t.status === "changed").map((t) => t.topicId)
  );
}

/**
 * Where the dialog's select-all box stands. It is measured against the
 * pre-ticked set, not every row: ticking it restores new and changed files
 * only, so "select all" never quietly re-imports what is already here.
 */
export function selectAllState(selected: ReadonlySet<number>, defaults: readonly number[]): "all" | "some" | "none" {
  const ticked = defaults.filter((id) => selected.has(id)).length;
  if (ticked === 0) return "none";
  return ticked === defaults.length ? "all" : "some";
}

/** What the select-all box does: add or remove the pre-ticked set, leaving any other tick alone. */
export function setDefaults(selected: ReadonlySet<number>, defaults: readonly number[], on: boolean): Set<number> {
  if (on) return new Set([...selected, ...defaults]);
  const drop = new Set(defaults);
  return new Set([...selected].filter((id) => !drop.has(id)));
}

// "CISC102" and "CISC 102" have to meet, so letters and digits split apart.
const tokens = (name: string): string[] => name.toLowerCase().match(/[a-z]+|\d+/g) ?? [];

// Three or more digits, but not a year: "F2026" tokenises to "2026" and
// would match every course of that term.
const isCourseNumber = (t: string) => /^\d{3,}$/.test(t) && !/^(19|20)\d\d$/.test(t);

/**
 * The onQ course a Lectern course most likely is, or null. A shared course
 * number is required: two intro courses share most of their words, and a
 * wrong pre-selection is worse than none. A tie (two sections of one course)
 * is no answer either.
 */
export function bestCourseMatch(folderName: string, courses: OnqCourse[]): number | null {
  const wanted = new Set(tokens(folderName));
  let best: { courseId: number; score: number; tied: boolean } | null = null;
  for (const course of courses) {
    const shared = tokens(course.name).filter((t) => wanted.has(t));
    if (!shared.some(isCourseNumber)) continue;
    const score = new Set(shared).size;
    if (!best || score > best.score) best = { courseId: course.courseId, score, tied: false };
    else if (score === best.score) best.tied = true;
  }
  return best && !best.tied ? best.courseId : null;
}

export function materialFromTopic(
  topic: OnqTopicText,
  moduleTitle: string,
  maxChars: number
): { draft: MaterialDraft } | { skip: string } {
  const text = topic.text?.trim() ?? "";
  if (!text) return { skip: topic.note ?? "onQ returned no readable text for this file." };
  if (text.length > maxChars) {
    return { skip: `This file's text is too long to store (${text.length.toLocaleString("en")} characters).` };
  }
  return {
    draft: {
      kind: guessKind(topic.extension, topic.title, moduleTitle),
      title: topic.title.slice(0, 300),
      text,
      sourceFileName: topic.sourceFileName?.slice(0, 300) ?? null,
      onqTopicId: topic.topicId,
      onqLastModified: topic.lastModified,
    },
  };
}

/** onq-mcp's two "log in again" errors both say "session"; nothing else it raises does. */
export function isSessionError(message: string): boolean {
  return /\bsession\b/i.test(message);
}

export async function runImport(
  targets: ImportTarget[],
  importOne: (target: ImportTarget) => Promise<ImportOutcome>,
  onStep: (text: string) => void
): Promise<ImportSummary> {
  const summary: ImportSummary = { imported: 0, updated: 0, skipped: [], aborted: null };

  for (const target of targets) {
    try {
      const result = await importOne(target);
      if (result.outcome === "imported" || result.outcome === "updated") {
        summary[result.outcome] += 1;
        onStep(`${target.title} — ${result.outcome}`);
        continue;
      }
      // The route's reply is parsed loosely, so anything but the three known
      // outcomes is reported rather than tallied under an undefined key.
      const reason =
        result.outcome === "skipped" ? (result.reason ?? "Skipped.") : "Lectern returned an unexpected result.";
      summary.skipped.push({ topicId: target.topicId, title: target.title, reason });
      onStep(`${target.title} — skipped`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "That file could not be imported.";
      // One bad file is that file's problem. A dead session is every
      // remaining file's problem, so stop and say so once.
      if (isSessionError(message)) {
        summary.aborted = message;
        return summary;
      }
      summary.skipped.push({ topicId: target.topicId, title: target.title, reason: message });
      onStep(`${target.title} — skipped`);
    }
  }
  return summary;
}
