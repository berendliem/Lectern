// Prediction questions asked BEFORE the lecture. Built from the topic title and
// the syllabus only — the lecture has not been watched, and a "pretest" that can
// see it is a quiz. The builder takes those two fields and nothing else, which
// is the guard: there is no parameter a lecture could arrive through.

import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

export const PRETEST_SYSTEM_PROMPT = `You write prediction questions for a student who is about to attend a lecture they have not yet seen. The student is expected to guess. A good question makes them commit to a belief about how something works, so that the lecture either confirms it or corrects it — guessing wrong is the point, not a failure.

Write exactly 3 questions. Each has 4 options, exactly one correct. Do not ask about definitions or terminology; ask about mechanisms, consequences, and trade-offs.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "questions": [
    {
      "prompt": string,
      "options": [string, string, string, string],
      "correctIndex": number,     // 0-3
      "explanation": string       // one or two sentences, shown only after the lecture is captured
    }
  ]
}

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildPretestUserPrompt(opts: { topicTitle: string; syllabusText: string }): string {
  return [
    `THE TOPIC THE STUDENT IS ABOUT TO STUDY: "${opts.topicTitle}"`,
    `WHAT THE SYLLABUS SAYS ABOUT THE COURSE:\n"""\n${opts.syllabusText.slice(0, 6000)}\n"""`,
    "Write the 3 prediction questions and return the required JSON.",
  ].join("\n\n");
}
