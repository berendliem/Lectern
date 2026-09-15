/**
 * Flashcards and quiz questions hang from exactly one parent: a lecture or a
 * course material. SQLite cannot express that exclusive-or through Prisma, so
 * these helpers are the enforcement — every create path routes through
 * assertSingleParent, and every course-scoped read through courseScopeFilter.
 */

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
 * office hours, not the subject.
 */
export function quizlessMaterialsFilter(folderId: string) {
  return {
    folderId,
    kind: { not: "SYLLABUS" as const },
    text: { not: "" },
    quizQuestions: { none: {} },
  };
}

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
