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

export type CardSource =
  | { kind: "lecture"; id: string; title: string }
  | { kind: "material"; id: string; title: string };

export function cardSource(row: {
  page: { id: string; title: string } | null;
  material: { id: string; title: string } | null;
}): CardSource | null {
  if (row.page) return { kind: "lecture", id: row.page.id, title: row.page.title };
  if (row.material) return { kind: "material", id: row.material.id, title: row.material.title };
  return null;
}
