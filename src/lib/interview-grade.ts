// src/lib/interview-grade.ts
// The typed interview's two model calls, shared with the live route, which
// falls back to them when a model's own grade line is missing or garbled.

import { callLLMJSON } from "@/lib/llm";
import {
  interviewFeedbackResponseSchema,
  interviewQuestionResponseSchema,
  rubricFor,
  type InterviewContext,
  type InterviewFeedback,
  type InterviewMode,
  type QAPair,
} from "@/lib/interview";
import type { FeynmanFeedback } from "@/lib/live-interview";
import {
  INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
  INTERVIEW_QUESTION_SYSTEM_PROMPT,
  buildFeedbackUserPrompt,
  buildNextQuestionUserPrompt,
} from "@/lib/prompts/interview";
import { FEYNMAN_SYSTEM_PROMPT, buildFeynmanUserPrompt } from "@/lib/prompts/feynman";
import { PROTEGE_QUESTION_SYSTEM_PROMPT, buildProtegeNextQuestionUserPrompt } from "@/lib/prompts/protege";
import { feynmanFeedbackSchema } from "@/lib/validation";

export const INTERVIEW_MODEL =
  process.env.OPENROUTER_MODEL_INTERVIEW ?? process.env.OPENROUTER_MODEL_QUIZ ?? "openrouter/free";

export type GradedAnswer = {
  feedback: InterviewFeedback | FeynmanFeedback;
  score: number;
  firstImprovement: string | null;
};

/** Throws on a model or format failure; callers decide what a failed grade means for them. */
export async function gradeAnswer(opts: {
  mode: InterviewMode;
  context: InterviewContext;
  question: string;
  answer: string;
  priorAnswers: string[];
}): Promise<GradedAnswer> {
  if (rubricFor(opts.mode) === "FEYNMAN") {
    const raw = await callLLMJSON({
      model: INTERVIEW_MODEL,
      systemPrompt: FEYNMAN_SYSTEM_PROMPT,
      userPrompt: buildFeynmanUserPrompt({
        concept: opts.question,
        reference: opts.context.notesMarkdown ?? opts.context.transcriptText ?? opts.context.topicText ?? undefined,
        explanation: opts.answer,
        priorExplanations: opts.priorAnswers,
      }),
    });
    const parsed = await feynmanFeedbackSchema.parseAsync(raw);
    return { feedback: parsed, score: parsed.score, firstImprovement: parsed.gaps[0] ?? null };
  }
  const raw = await callLLMJSON({
    model: INTERVIEW_MODEL,
    systemPrompt: INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
    userPrompt: buildFeedbackUserPrompt(opts.context, opts.question, opts.answer),
  });
  const parsed = await interviewFeedbackResponseSchema.parseAsync(raw);
  return { feedback: parsed, score: parsed.score, firstImprovement: parsed.improvements[0] ?? null };
}

export async function generateNextQuestion(opts: {
  mode: InterviewMode;
  context: InterviewContext;
  history: QAPair[];
}): Promise<string> {
  const protege = opts.mode === "PROTEGE";
  const raw = await callLLMJSON({
    model: INTERVIEW_MODEL,
    systemPrompt: protege ? PROTEGE_QUESTION_SYSTEM_PROMPT : INTERVIEW_QUESTION_SYSTEM_PROMPT,
    userPrompt: protege
      ? buildProtegeNextQuestionUserPrompt(opts.context, opts.history)
      : buildNextQuestionUserPrompt(opts.context, opts.history),
  });
  return (await interviewQuestionResponseSchema.parseAsync(raw)).question;
}
