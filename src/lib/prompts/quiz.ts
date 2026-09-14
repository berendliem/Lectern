import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

export const QUIZ_SYSTEM_PROMPT = `You are an expert exam writer creating a short self-test quiz from lecture notes.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "questions": [
    {
      "type": "SHORT_ANSWER",
      "prompt": string,
      "correctAnswer": string,        // a concise reference answer, a few words to one sentence
      "explanation": string           // optional short rationale
    },
    {
      "type": "MULTIPLE_CHOICE",
      "prompt": string,
      "correctAnswer": string,        // must exactly match one of the strings in "options"
      "options": [string, string, string, string],
      "explanation": string
    },
    {
      "type": "CLOZE",
      "prompt": string,               // one sentence with the removed term marked {{like this}}
      "correctAnswer": string,        // the removed term on its own, without the braces
      "explanation": string
    },
    {
      "type": "MATH",
      "prompt": string,               // LaTeX for the notation; it will be rendered
      "correctAnswer": string,        // one canonical value in plain ASCII
      "explanation": string
    }
  ]
}

Guidelines:
- Generate 6-10 questions total, with a mix of SHORT_ANSWER, MULTIPLE_CHOICE and CLOZE.
- For MULTIPLE_CHOICE, write plausible distractors (not obviously wrong) and include 3-5 options.
- For CLOZE, remove exactly one term per sentence and mark it {{like this}}. Leave enough of the sentence around the gap that the answer is recallable but not guessable, and repeat the removed term verbatim in correctAnswer.
- Test understanding of concepts from the notes, not just trivia/dates.
- Base everything only on the provided notes; do not invent facts.
- Use MATH when the answer is a value the student computes: a number, a fraction, a set, a vector, a matrix, or an expression. Notes with mathematical content should get several.
- Write MATH prompts with LaTeX for the notation ($x^2$, $\\det(A)$, $\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}$) — it is rendered, not shown as source.
- Write a MATH correctAnswer as one canonical value in plain ASCII: "1/2", "-2", "[[1,2],[3,4]]", "{2,3,5}", "x^2+1". Not LaTeX, not a sentence, no units, no "the answer is".
- Never use MATH for a proof, a derivation, or an "explain why" question. Those are SHORT_ANSWER.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildQuizUserPrompt(notesMarkdown: string): string {
  return `Here are study notes from a lecture. Generate a self-test quiz following the required JSON shape.\n\nNOTES:\n"""\n${notesMarkdown}\n"""`;
}

/** One question the student has already got wrong, and the answer they missed. */
export type MissedQuestion = { prompt: string; correctAnswer: string };

/**
 * Re-asking the identical question tests whether the student remembers the
 * answer they were just shown, which is not the same as understanding the idea.
 * So the misses are given as the subject matter and the model is asked to come
 * at each one from a different direction.
 */
export function buildMissesQuizUserPrompt(notesMarkdown: string, misses: MissedQuestion[]): string {
  const missed = misses
    .map((m, i) => `${i + 1}. Question: ${m.prompt}\n   Correct answer: ${m.correctAnswer}`)
    .join("\n");

  return `Here are study notes from a lecture, followed by the questions this student answered wrongly.

Write a new quiz that tests the same underlying concepts as those missed questions. Do not repeat any missed question as written — change the angle: ask for an application where the original asked for a definition, ask about a consequence where it asked about a cause, or invert which side of a relationship is given. Cover every missed concept at least once, and base everything on the notes.

MISSED QUESTIONS:
"""
${missed}
"""

NOTES:
"""
${notesMarkdown}
"""`;
}
