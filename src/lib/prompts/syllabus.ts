import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

export const SYLLABUS_SYSTEM_PROMPT = `You extract the topic outline from a university course syllabus.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "topics": [
    {
      "title": string,  // the topic as the syllabus names it, e.g. "Hypothesis testing and p-values"
      "week": number    // optional: the week or session number the syllabus schedules it in (omit if the syllabus gives none)
    }
  ]
}

Guidelines:
- List the subject-matter topics the course teaches, in the order the syllabus presents them.
- Skip administrative content: grading policy, office hours, attendance rules, exam dates with no topic, reading lists without a subject.
- Keep a title to a short phrase a lecture could be about. Do not invent topics the syllabus does not name.
- If one week covers several distinct topics, emit one entry per topic, each with that week number.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildSyllabusUserPrompt(syllabusText: string): string {
  return `Here is a course syllabus. Extract its topic outline following the required JSON shape.\n\nSYLLABUS:\n"""\n${syllabusText}\n"""`;
}
