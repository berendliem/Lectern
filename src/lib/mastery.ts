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
  learning: "bg-yellow-100 text-yellow-700",
  mastered: "bg-green-100 text-green-700",
};
