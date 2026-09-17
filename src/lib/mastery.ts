// Turbo-style mastery states derived from SM-2 repetition history:
// never reviewed = New, reviewed but not yet stable = Learning,
// 3+ consecutive successful reviews = Mastered.

export type Mastery = "new" | "learning" | "mastered";

export function masteryOf(repetitions: number, lastReviewedAt: string | Date | null): Mastery {
  if (!lastReviewedAt && repetitions === 0) return "new";
  if (repetitions >= 3) return "mastered";
  return "learning";
}

export const MASTERY_LABEL: Record<Mastery, string> = {
  new: "New",
  learning: "Learning",
  mastered: "Mastered",
};

export const MASTERY_CLASSES: Record<Mastery, string> = {
  new: "bg-surface-3 text-ink-soft",
  learning: "bg-daisy-soft text-daisy-ink",
  mastered: "bg-moss-soft text-moss-ink",
};

/**
 * A leech, in SM-2's sense: a card that keeps failing without ever settling.
 * `misses` counts ledger rows scored below 3 since the ledger began; a card
 * that has since reached three consecutive passes has outgrown the label.
 */
export const LEECH_MISSES = 4;

export function isLeech(misses: number, repetitions: number): boolean {
  return misses >= LEECH_MISSES && repetitions < 3;
}
