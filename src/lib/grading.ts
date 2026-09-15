const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "in", "on", "to", "for", "and", "or", "but", "it", "its", "this",
  "that", "with", "as", "by", "at", "from",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 0 && !STOPWORDS.has(word))
  );
}

/** Jaccard overlap at or above which the local grader calls an answer right. */
export const OVERLAP_PASS = 0.5;

export type ShortAnswerGrade = {
  isCorrect: boolean;
  similarity: number;
};

/**
 * Grades a free-text short answer by token overlap against the reference
 * answer (Jaccard similarity over non-stopword tokens). Simple and fully
 * local -- no extra model call needed just to grade a quiz answer.
 */
export function gradeShortAnswer(
  userAnswer: string,
  correctAnswer: string,
  threshold = OVERLAP_PASS
): ShortAnswerGrade {
  const userTokens = tokenize(userAnswer);
  const correctTokens = tokenize(correctAnswer);

  if (correctTokens.size === 0) {
    return { isCorrect: userTokens.size === 0, similarity: userTokens.size === 0 ? 1 : 0 };
  }

  let intersection = 0;
  for (const token of userTokens) {
    if (correctTokens.has(token)) intersection += 1;
  }
  const union = new Set([...userTokens, ...correctTokens]).size;
  const similarity = union === 0 ? 0 : intersection / union;

  return { isCorrect: similarity >= threshold, similarity };
}

export function gradeMultipleChoice(userAnswer: string, correctAnswer: string): boolean {
  return userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
}

/**
 * The bar a free-text answer has to clear to count as mastered. A quiz
 * question or a review card scoring below this goes back into the session
 * queue instead of being left behind at whatever the first attempt was worth.
 *
 * Read it as an LLM score, not as a percentage correct: free-text graders
 * cluster in the 60-90 band, so 85 means "essentially the whole answer".
 */
export const MASTERY_SCORE = 85;

/**
 * How many times one item may come back before the session lets it go. Without
 * a cap a student who cannot reach the bar on one card is stuck in a session
 * that never ends — the summary flags it as unmastered instead.
 */
export const MAX_MASTERY_ATTEMPTS = 3;

/**
 * SM-2 quality for a 0-100 answer score, and its inverse for a student who
 * overrides the machine with a button.
 *
 * The two have to be inverses, and 4-and-up has to mean mastered, or the
 * session contradicts itself: a card graded "Good" and then requeued for
 * missing the bar tells the student their correct answer was wrong. The bands
 * follow the grader's own rubric — 60-84 is "a real gap", which is SM-2's
 * "Hard", not its "Good".
 */
export function qualityForScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score >= 95) return 5;
  if (score >= MASTERY_SCORE) return 4;
  if (score >= 60) return 3;
  return 0;
}

export function scoreForQuality(quality: number): number {
  if (quality >= 5) return 100;
  if (quality >= 4) return 90;
  if (quality >= 3) return 70;
  return 0;
}

/** Whether an item answered at `score` should go to the back of the queue. */
export function shouldRequeue(score: number, attempts: number): boolean {
  if (!Number.isFinite(score)) return false;
  return score < MASTERY_SCORE && attempts < MAX_MASTERY_ATTEMPTS;
}
