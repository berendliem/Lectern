import { callLLMJSON } from "@/lib/llm";
import { answerGradeResponseSchema } from "@/lib/validation";
import { ANSWER_GRADE_SYSTEM_PROMPT, buildAnswerGradeUserPrompt } from "@/lib/prompts/answer-grade";
import { gradeShortAnswer, MASTERY_SCORE, OVERLAP_PASS } from "@/lib/grading";

const MODEL =
  process.env.OPENROUTER_MODEL_GRADING ??
  process.env.OPENROUTER_MODEL_CHAT ??
  process.env.OPENROUTER_MODEL_SUMMARY ??
  "openrouter/free";

export type AnswerGrade = {
  /** 0-100. */
  score: number;
  verdict: string;
  missing: string[];
  /** Which grader produced the score — "overlap" means the model was unreachable. */
  grader: "llm" | "overlap";
};

/**
 * Marks one free-text answer against its reference answer.
 *
 * The token-overlap grader is the fallback rather than the default: it counts
 * shared words, so it fails a correct answer written in the student's own
 * words — exactly the answer worth the most. When the model is unreachable a
 * rough score still beats refusing to grade, because a failed grade would
 * strand the student mid-session with nothing recorded.
 */
export async function gradeFreeTextAnswer(opts: {
  prompt: string;
  reference: string;
  answer: string;
}): Promise<AnswerGrade> {
  try {
    const raw = await callLLMJSON({
      model: MODEL,
      systemPrompt: ANSWER_GRADE_SYSTEM_PROMPT,
      userPrompt: buildAnswerGradeUserPrompt(opts),
    });
    const parsed = await answerGradeResponseSchema.parseAsync(raw);
    return {
      score: Math.round(parsed.score),
      verdict: parsed.verdict,
      missing: parsed.missing,
      grader: "llm",
    };
  } catch (e) {
    console.error("[grading] the answer grader fell back to token overlap:", e);
    const { similarity } = gradeShortAnswer(opts.answer, opts.reference);
    // Stretched onto the mastery scale rather than read as a percentage: raw
    // Jaccard overlap almost never reaches 0.85, so a plain ×100 would fail
    // every answer for as long as the model was unreachable. OVERLAP_PASS is
    // the threshold gradeShortAnswer itself passes at, mapped to the bar.
    return {
      score: Math.min(100, Math.round((similarity / OVERLAP_PASS) * MASTERY_SCORE)),
      verdict: "Graded offline by word overlap — the marking model was unreachable.",
      missing: [],
      grader: "overlap",
    };
  }
}
