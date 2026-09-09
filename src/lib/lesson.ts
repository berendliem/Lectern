// A recitation lesson: an outline turned into scenes the app can actually
// render. Pure — the route owns the two completions and the retrieval.
//
// Lessons are not persisted. The scene list is generated per request and
// discarded; only the recall events the scenes produce survive, and those are
// the part with value.
// ponytail: ephemeral lessons; add a Lesson table the first time someone asks to
// resume one mid-way.

import { z } from "zod";

export const LESSON_SCENES = ["RECALL", "EXPLAIN", "TEACH", "CHECK"] as const;
export type SceneKind = (typeof LESSON_SCENES)[number];

export type LessonScene = {
  kind: SceneKind;
  title: string;
  /** The question put to the student. Null on EXPLAIN, which asks nothing. */
  prompt: string | null;
  /** The cited excerpt. Only EXPLAIN carries one. */
  body: string | null;
  /** Where the excerpt came from, for the citation line. */
  citation: string | null;
};

/** Stage one: the shape of the lesson, before any of it is written. */
export const lessonOutlineResponseSchema = z.object({
  beats: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        focus: z.string().trim().min(1).max(600),
      })
    )
    .min(4)
    .max(6),
});

export const lessonScenesResponseSchema = z.object({
  scenes: z
    .array(
      z.object({
        kind: z.enum(LESSON_SCENES),
        title: z.string().trim().min(1).max(200),
        prompt: z.string().trim().max(1000).nullable().default(null),
        body: z.string().trim().max(4000).nullable().default(null),
        citation: z.string().trim().max(300).nullable().default(null),
      })
    )
    .min(4)
    .max(6),
});

/**
 * A lesson always opens on RECALL and never on EXPLAIN. Being asked first and
 * told second is the whole point; a lesson that leads with the notes is a page
 * of notes with quizzes stapled on. The first RECALL beat is hoisted rather than
 * the list re-sorted, so the model's ordering survives everywhere else.
 */
export function openOnRecall(scenes: LessonScene[]): LessonScene[] {
  const i = scenes.findIndex((s) => s.kind === "RECALL");
  if (i < 0) throw new Error("A lesson needs at least one RECALL scene");
  if (i === 0) return scenes;
  return [scenes[i], ...scenes.slice(0, i), ...scenes.slice(i + 1)];
}

/**
 * A CHECK renders an *existing* quiz question. With none for this topic the beat
 * is dropped: generating one here would quietly make the lesson route a quiz
 * generator, with a second prompt to maintain and no way for the student to tell
 * which questions came from where.
 */
export function dropUnbackedChecks(scenes: LessonScene[], hasQuizQuestion: boolean): LessonScene[] {
  return hasQuizQuestion ? scenes : scenes.filter((s) => s.kind !== "CHECK");
}
