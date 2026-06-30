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

export type ShortAnswerGrade = {
  isCorrect: boolean;
  similarity: number;
};

/**
 * Grades a free-text short answer by token overlap against the reference
 * answer (Jaccard similarity over non-stopword tokens). Simple and fully
 * local -- no extra model call needed just to grade a quiz answer.
 */
export function gradeShortAnswer(userAnswer: string, correctAnswer: string, threshold = 0.5): ShortAnswerGrade {
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
