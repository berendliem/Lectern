import { z } from "zod";

/** Total number of questions (turns) in an interview session before it auto-completes. */
export const MAX_INTERVIEW_QUESTIONS = 6;

export const createInterviewSessionSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("LECTURE"),
    pageId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(300),
  }),
  z.object({
    source: z.literal("TOPIC"),
    topicText: z.string().trim().min(1).max(8000),
    title: z.string().trim().max(300).optional(),
  }),
]);

export type CreateInterviewSessionInput = z.infer<typeof createInterviewSessionSchema>;

export const submitAnswerSchema = z.object({
  turnId: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(4000),
});

export const interviewQuestionResponseSchema = z.object({
  question: z.string().trim().min(1),
});

export const interviewFeedbackResponseSchema = z.object({
  strengths: z.array(z.string().trim().min(1)).min(1).max(5),
  improvements: z.array(z.string().trim().min(1)).min(1).max(5),
  score: z.number().int().min(1).max(5),
  modelAnswer: z.string().trim().min(1),
});

export type InterviewFeedback = z.infer<typeof interviewFeedbackResponseSchema>;

/** Everything the model needs to know about what this interview is about. */
export type InterviewContext = {
  title: string;
  source: "LECTURE" | "TOPIC";
  notesMarkdown?: string | null;
  transcriptText?: string | null;
  topicText?: string | null;
};

export type QAPair = { question: string; answer: string };

export function averageScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
