import { z } from "zod";
import type { RecallRaw } from "@/lib/recall";

/** Total number of questions (turns) in an interview session before it auto-completes. */
export const MAX_INTERVIEW_QUESTIONS = 6;

export type InterviewMode = "VIVA" | "PROTEGE" | "DEBATE";

/** Which grader marks the answer. PROTEGE judges the explanation, not the answer. */
export type Rubric = "INTERVIEWER" | "FEYNMAN";

export function rubricFor(mode: InterviewMode): Rubric {
  return mode === "PROTEGE" ? "FEYNMAN" : "INTERVIEWER";
}

/**
 * The graded number in the units its grader produced. The Feynman coach emits
 * 0-100 and the interviewer 1-5; `normalizeQuality` knows how to map each, and
 * converting here would hide a scale error behind a plausible-looking integer.
 */
export function recallRawFor(mode: InterviewMode, graded: { score: number }): RecallRaw {
  return rubricFor(mode) === "FEYNMAN"
    ? { kind: "FEYNMAN", score: graded.score }
    : { kind: "INTERVIEW", rating: graded.score };
}

export const createInterviewSessionSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("LECTURE"),
    pageId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(300),
    mode: z.enum(["VIVA", "PROTEGE"]).default("VIVA"),
    persona: z.string().trim().max(600).optional(),
  }),
  z.object({
    source: z.literal("TOPIC"),
    topicText: z.string().trim().min(1).max(8000),
    title: z.string().trim().max(300).optional(),
    mode: z.enum(["VIVA", "PROTEGE"]).default("VIVA"),
    persona: z.string().trim().max(600).optional(),
  }),
  // A course-scoped session is the only one that can be a debate, because it is
  // the only one with a CourseTopic to hang the ledger event on.
  z.object({
    source: z.literal("COURSE_TOPIC"),
    courseTopicId: z.string().trim().min(1),
    title: z.string().trim().max(300).optional(),
    mode: z.enum(["PROTEGE", "DEBATE"]),
    persona: z.string().trim().max(600).optional(),
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
  source: "LECTURE" | "TOPIC" | "COURSE_TOPIC";
  notesMarkdown?: string | null;
  transcriptText?: string | null;
  topicText?: string | null;
};

export type QAPair = { question: string; answer: string };

export function averageScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
