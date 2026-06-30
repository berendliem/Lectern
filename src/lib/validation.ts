import { z } from "zod";

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  color: z.string().trim().max(32).optional(),
});

export const updateFolderSchema = createFolderSchema.partial();

export const createPageSchema = z.object({
  title: z.string().trim().min(1).max(300),
  folderId: z.string().trim().min(1).optional(),
});

export const updatePageSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  folderId: z.string().trim().min(1).nullable().optional(),
  notesMarkdown: z.string().optional(),
});

export const tagOnPageSchema = z.object({
  pageId: z.string().trim().min(1),
  tagName: z.string().trim().min(1).max(64),
});

export const reviewGradeSchema = z.object({
  quality: z.number().int().min(0).max(5),
});

export const quizAnswerSchema = z.object({
  answer: z.string().trim().min(0).max(2000),
});

export const summaryResponseSchema = z.object({
  markdown: z.string().min(1),
  keyTerms: z.array(z.object({ term: z.string().min(1), definition: z.string().min(1) })),
});

export const flashcardsResponseSchema = z.object({
  flashcards: z
    .array(
      z.object({
        prompt: z.string().min(1),
        idealExplanation: z.string().min(1),
        sourceTerm: z.string().optional(),
      })
    )
    .min(1),
});

export const quizResponseSchema = z.object({
  questions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("SHORT_ANSWER"),
          prompt: z.string().min(1),
          correctAnswer: z.string().min(1),
          explanation: z.string().optional(),
        }),
        z.object({
          type: z.literal("MULTIPLE_CHOICE"),
          prompt: z.string().min(1),
          correctAnswer: z.string().min(1),
          options: z.array(z.string().min(1)).min(2),
          explanation: z.string().optional(),
        }),
      ])
    )
    .min(1),
});
