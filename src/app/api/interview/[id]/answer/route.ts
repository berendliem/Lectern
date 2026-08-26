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
  type InterviewContext,
  type QAPair,
} from "@/lib/interview";
import {
  INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
  buildFeedbackUserPrompt,
  INTERVIEW_QUESTION_SYSTEM_PROMPT,
  buildNextQuestionUserPrompt,
} from "@/lib/prompts/interview";

const MODEL =
  process.env.OPENROUTER_MODEL_INTERVIEW ?? process.env.OPENROUTER_MODEL_QUIZ ?? "meta-llama/llama-3.3-70b-instruct:free";

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
    topicText: session.topicText,
  };

  let feedback;
  try {
    const raw = await callLLMJSON({
      model: MODEL,
      systemPrompt: INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
      userPrompt: buildFeedbackUserPrompt(context, turn.question, answer),
    });
    feedback = await interviewFeedbackResponseSchema.parseAsync(raw);
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
    const raw = await callLLMJSON({
      model: MODEL,
      systemPrompt: INTERVIEW_QUESTION_SYSTEM_PROMPT,
      userPrompt: buildNextQuestionUserPrompt(context, history),
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
