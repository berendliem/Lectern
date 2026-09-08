import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import {
  MAX_INTERVIEW_QUESTIONS,
  submitAnswerSchema,
  interviewFeedbackResponseSchema,
  interviewQuestionResponseSchema,
  rubricFor,
  recallRawFor,
  type InterviewContext,
  type QAPair,
} from "@/lib/interview";
import {
  INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
  buildFeedbackUserPrompt,
  INTERVIEW_QUESTION_SYSTEM_PROMPT,
  buildNextQuestionUserPrompt,
} from "@/lib/prompts/interview";
import { FEYNMAN_SYSTEM_PROMPT, buildFeynmanUserPrompt } from "@/lib/prompts/feynman";
import { PROTEGE_QUESTION_SYSTEM_PROMPT, buildProtegeNextQuestionUserPrompt } from "@/lib/prompts/protege";
import { feynmanFeedbackSchema } from "@/lib/validation";
import { writeRecallSafely } from "@/lib/recall-log";

const MODEL =
  process.env.OPENROUTER_MODEL_INTERVIEW ?? process.env.OPENROUTER_MODEL_QUIZ ?? "openrouter/free";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(submitAnswerSchema, body);
  if ("error" in result) return result.error;
  const { turnId, answer } = result.data;

  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      page: { include: { notes: true, transcript: true } },
      topic: { select: { id: true, title: true } },
    },
  });
  if (!session) return jsonError("Interview session not found", 404);

  const turn = session.turns.find((t) => t.id === turnId);
  if (!turn) return jsonError("Question not found in this session", 404);
  if (turn.answer !== null) return jsonError("This question has already been answered", 422);

  const context: InterviewContext = {
    title: session.title,
    source: session.source,
    notesMarkdown: session.page?.notes?.markdown ?? null,
    transcriptText: session.page?.transcript?.rawText ?? null,
    topicText: session.topicText ?? session.topic?.title ?? null,
  };

  const rubric = rubricFor(session.mode);

  let feedback: unknown;
  let score: number;
  let firstImprovement: string | null;
  try {
    if (rubric === "FEYNMAN") {
      const raw = await callLLMJSON({
        model: MODEL,
        systemPrompt: FEYNMAN_SYSTEM_PROMPT,
        userPrompt: buildFeynmanUserPrompt({
          concept: turn.question,
          reference: context.notesMarkdown ?? context.transcriptText ?? context.topicText ?? undefined,
          explanation: answer,
          priorExplanations: session.turns
            .filter((t) => t.answer !== null && t.id !== turn.id)
            .map((t) => t.answer as string),
        }),
      });
      const parsed = await feynmanFeedbackSchema.parseAsync(raw);
      feedback = parsed;
      score = parsed.score;
      firstImprovement = parsed.gaps[0] ?? null;
    } else {
      const raw = await callLLMJSON({
        model: MODEL,
        systemPrompt: INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
        userPrompt: buildFeedbackUserPrompt(context, turn.question, answer),
      });
      const parsed = await interviewFeedbackResponseSchema.parseAsync(raw);
      feedback = parsed;
      score = parsed.score;
      firstImprovement = parsed.improvements[0] ?? null;
    }
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Failed to grade your answer";
    return jsonError(message, 502);
  }

  await db.interviewTurn.update({
    where: { id: turn.id },
    data: { answer, feedback: JSON.stringify(feedback) },
  });

  // A topic-sourced session has no page, so the event lands parentless rather
  // than being dropped — the scale is the point, the parent is a bonus.
  await writeRecallSafely({
    raw: recallRawFor(session.mode, { score }),
    pageId: session.pageId,
    topicId: session.courseTopicId,
    misconception: firstImprovement,
    detail: { question: turn.question, score, mode: session.mode },
  });

  const answeredCount = session.turns.filter((t) => t.answer !== null).length + 1;

  if (answeredCount >= MAX_INTERVIEW_QUESTIONS) {
    await db.interviewSession.update({ where: { id: session.id }, data: { status: "COMPLETED" } });
    return NextResponse.json({ feedback, completed: true });
  }

  const history: QAPair[] = [
    ...session.turns
      .filter((t) => t.answer !== null)
      .map((t) => ({ question: t.question, answer: t.answer as string })),
    { question: turn.question, answer },
  ];

  try {
    const usingProtege = session.mode === "PROTEGE";
    const raw = await callLLMJSON({
      model: MODEL,
      systemPrompt: usingProtege ? PROTEGE_QUESTION_SYSTEM_PROMPT : INTERVIEW_QUESTION_SYSTEM_PROMPT,
      userPrompt: usingProtege
        ? buildProtegeNextQuestionUserPrompt(context, history)
        : buildNextQuestionUserPrompt(context, history),
    });
    const parsed = await interviewQuestionResponseSchema.parseAsync(raw);
    const nextOrder = session.turns.reduce((max, t) => Math.max(max, t.order), turn.order) + 1;
    const nextTurn = await db.interviewTurn.create({
      data: { sessionId: session.id, order: nextOrder, question: parsed.question },
    });
    return NextResponse.json({ feedback, nextTurn });
  } catch {
    // We already saved the answer + feedback; if the model fails to produce
    // a follow-up question, end the session gracefully instead of losing
    // the user's progress.
    await db.interviewSession.update({ where: { id: session.id }, data: { status: "COMPLETED" } });
    return NextResponse.json({ feedback, completed: true });
  }
}
