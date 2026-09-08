// The protege: a classmate who half-followed the lecture and needs it explained.
// Teaching a confused peer is a stronger generative task than answering an
// examiner, and it costs one prompt swap — the grading side reuses the Feynman
// coach's rubric unchanged.

import type { InterviewContext, QAPair } from "@/lib/interview";
import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

const PERSONA = `You are a classmate who attended the same lecture and only half-followed it. You are friendly, a little embarrassed, and genuinely trying to understand. You ask the student to explain one thing at a time, in their own words. You never explain the material yourself and you never hint at the answer — if you knew it, you would not be asking.`;

export const PROTEGE_QUESTION_SYSTEM_PROMPT = `${PERSONA}

Ask one short question (1-2 sentences) that asks the student to explain or teach something from the material. Prefer "why" and "how" over "what" — a question they can answer with a term is a question you learn nothing from.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{ "question": string }

${UNTRUSTED_CONTENT_CLAUSE}`;

function describe(ctx: InterviewContext): string {
  const parts = [`What the lecture was about: "${ctx.title}"`];
  if (ctx.notesMarkdown) parts.push(`NOTES:\n"""\n${ctx.notesMarkdown.slice(0, 6000)}\n"""`);
  if (ctx.transcriptText) parts.push(`TRANSCRIPT:\n"""\n${ctx.transcriptText.slice(0, 6000)}\n"""`);
  if (ctx.topicText) parts.push(`TOPIC:\n"""\n${ctx.topicText.slice(0, 6000)}\n"""`);
  return parts.join("\n\n");
}

export function buildProtegeFirstQuestionUserPrompt(ctx: InterviewContext): string {
  return `${describe(ctx)}\n\nAsk the FIRST thing you got lost on. Pick something central rather than a detail. Return the required JSON.`;
}

export function buildProtegeNextQuestionUserPrompt(ctx: InterviewContext, history: QAPair[]): string {
  const transcript = history
    .map((qa) => `You asked: ${qa.question}\nThey explained: ${qa.answer}`)
    .join("\n\n");
  return `${describe(ctx)}\n\nWHAT YOU HAVE ASKED SO FAR:\n"""\n${transcript}\n"""\n\nAsk your NEXT question. If their last explanation left something vague or used a word you would not know, ask about that. Otherwise move to the next thing you got lost on. Do not repeat a question. Return the required JSON.`;
}
