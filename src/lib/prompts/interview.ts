import type { InterviewContext, QAPair } from "@/lib/interview";
import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

const PERSONA = `You are an expert interviewer: encouraging but rigorous. You ask open-ended questions that probe real understanding rather than trivia recall. Each question is concise (1-2 sentences) and clear.`;

export const INTERVIEW_QUESTION_SYSTEM_PROMPT = `${PERSONA}

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{ "question": string }

${UNTRUSTED_CONTENT_CLAUSE}`;

export const INTERVIEW_FEEDBACK_SYSTEM_PROMPT = `${PERSONA}

You are now grading a single answer the candidate just gave. Be specific and reference the actual content of their answer rather than generic praise or criticism.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "strengths": [string, ...],       // 1-3 concrete things the answer did well
  "improvements": [string, ...],    // 1-3 concrete, actionable things to improve
  "score": number,                  // integer 1-5 (5 = excellent, 1 = missed the point)
  "modelAnswer": string             // a strong model answer to the question, a few sentences
}

${UNTRUSTED_CONTENT_CLAUSE}`;

function describeContext(ctx: InterviewContext): string {
  if (ctx.source === "LECTURE") {
    const parts = [`Lecture title: "${ctx.title}"`];
    if (ctx.notesMarkdown) {
      parts.push(`LECTURE NOTES:\n"""\n${ctx.notesMarkdown.slice(0, 6000)}\n"""`);
    }
    if (ctx.transcriptText) {
      parts.push(`LECTURE TRANSCRIPT (may be long and informal):\n"""\n${ctx.transcriptText.slice(0, 6000)}\n"""`);
    }
    return parts.join("\n\n");
  }
  return `Interview topic / job description: "${ctx.title}"\n\n"""\n${(ctx.topicText ?? "").slice(0, 6000)}\n"""`;
}

function groundingInstruction(ctx: InterviewContext): string {
  return ctx.source === "LECTURE"
    ? "Ground every question in the lecture notes/transcript below; do not ask about things not covered there."
    : "This is mock interview prep for the topic or job description below; ask questions a strong real interviewer would ask about it.";
}

export function buildFirstQuestionUserPrompt(ctx: InterviewContext): string {
  return `${describeContext(ctx)}\n\n${groundingInstruction(ctx)}\n\nWrite the FIRST interview question to open the session. Return the required JSON.`;
}

export function buildNextQuestionUserPrompt(ctx: InterviewContext, history: QAPair[]): string {
  const transcript = history.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join("\n\n");
  return `${describeContext(ctx)}\n\n${groundingInstruction(ctx)}\n\nQUESTION AND ANSWER HISTORY SO FAR:\n"""\n${transcript}\n"""\n\nWrite the NEXT adaptive follow-up question. Dig into gaps, vague spots, or interesting threads in the most recent answer, or pivot to a new angle of the material if the previous answer was thorough. Do not repeat a previous question. Return the required JSON.`;
}

export function buildFeedbackUserPrompt(ctx: InterviewContext, question: string, answer: string): string {
  return `${describeContext(ctx)}\n\nQUESTION ASKED:\n"""\n${question}\n"""\n\nCANDIDATE'S ANSWER:\n"""\n${answer}\n"""\n\nGrade this answer and return the required JSON.`;
}
