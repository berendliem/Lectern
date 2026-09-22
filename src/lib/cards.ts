/**
 * Flashcards and quiz questions hang from exactly one parent: a lecture or a
 * course material. SQLite cannot express that exclusive-or through Prisma, so
 * these helpers are the enforcement — every create path routes through
 * assertSingleParent, and every course-scoped read through courseScopeFilter.
 */

import { WALKTHROUGH_SOURCE_TERM } from "./walkthrough.ts";

export type CardParent = { pageId?: string | null; materialId?: string | null };

export function assertSingleParent(
  parent: CardParent
): { pageId: string; materialId: null } | { pageId: null; materialId: string } {
  const hasPage = typeof parent.pageId === "string" && parent.pageId.length > 0;
  const hasMaterial = typeof parent.materialId === "string" && parent.materialId.length > 0;

  if (hasPage === hasMaterial) {
    throw new Error(
      "A card must belong to exactly one of a lecture or a material, not both and not neither."
    );
  }
  return hasPage
    ? { pageId: parent.pageId as string, materialId: null }
    : { pageId: null, materialId: parent.materialId as string };
}

/**
 * Course scoping for cards, which now reach a course through either relation.
 * Filtering on `page: { folderId }` alone silently hides every material card.
 */
export function courseScopeFilter(folderId: string) {
  return {
    OR: [{ page: { folderId } }, { material: { folderId } }],
  };
}

/**
 * A course's materials that exam cram could draw questions from but has none
 * yet. The syllabus is left out: a quiz on it asks about grading policy and
 * office hours, not the subject. Text is not checked: the create schema
 * refuses an empty body and nothing edits it afterwards.
 */
export function quizlessMaterialsFilter(folderId: string) {
  return {
    folderId,
    kind: { not: "SYLLABUS" as const },
    quizQuestions: { none: {} },
  };
}

/** Marks a card born from a blurt, so a deck shows where it came from. */
export const BLURT_SOURCE_TERM = "From a blurt";

/** Marks a card the ledger wrote after the student missed one thing `strikes` times. */
export const missedSourceTerm = (strikes: number) => `Missed ${strikes}×`;

/**
 * Cards the student earned by getting something wrong: a walkthrough step, a
 * blurt, a miss the ledger saw repeatedly. Generation never recreates them, so
 * regenerating a set replaces only the rest.
 */
export const earnedCardFilter = {
  OR: [
    { sourceTerm: WALKTHROUGH_SOURCE_TERM },
    { sourceTerm: BLURT_SOURCE_TERM },
    { sourceTerm: { startsWith: "Missed ", endsWith: "×" } },
  ],
};

/**
 * Every card a regenerate replaces. `NOT` alone would skip a null sourceTerm,
 * since SQL's NOT of a comparison with NULL is NULL, and a null one is a
 * generated card too.
 */
export const generatedCardFilter = { OR: [{ sourceTerm: null }, { NOT: earnedCardFilter }] };

export type CardSource =
  | { kind: "lecture"; id: string; title: string; course: string | null }
  | { kind: "material"; id: string; title: string; course: string | null };

export function cardSource(row: {
  page: { id: string; title: string; folder?: { name: string } | null } | null;
  material: { id: string; title: string; folder?: { name: string } | null } | null;
}): CardSource | null {
  if (row.page)
    return {
      kind: "lecture",
      id: row.page.id,
      title: row.page.title,
      course: row.page.folder?.name ?? null,
    };
  if (row.material)
    return {
      kind: "material",
      id: row.material.id,
      title: row.material.title,
      course: row.material.folder?.name ?? null,
    };
  return null;
}
