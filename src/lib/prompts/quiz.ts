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
    }
  ]
}

Guidelines:
- Generate 6-10 questions total, with a mix of SHORT_ANSWER and MULTIPLE_CHOICE.
- For MULTIPLE_CHOICE, write plausible distractors (not obviously wrong) and include 3-5 options.
- Test understanding of concepts from the notes, not just trivia/dates.
- Base everything only on the provided notes; do not invent facts.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildQuizUserPrompt(notesMarkdown: string): string {
  return `Here are study notes from a lecture. Generate a self-test quiz following the required JSON shape.\n\nNOTES:\n"""\n${notesMarkdown}\n"""`;
}
