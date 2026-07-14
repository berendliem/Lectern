import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callOpenRouterJSON } from "@/lib/openrouter";
import { createInterviewSessionSchema, interviewQuestionResponseSchema, type InterviewContext } from "@/lib/interview";
import { INTERVIEW_QUESTION_SYSTEM_PROMPT, buildFirstQuestionUserPrompt } from "@/lib/prompts/interview";

const MODEL =
  process.env.OPENROUTER_MODEL_INTERVIEW ?? process.env.OPENROUTER_MODEL_QUIZ ?? "meta-llama/llama-3.3-70b-instruct:free";

export async function GET() {
  const sessions = await db.interviewSession.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { turns: true } } },
  });
  return NextResponse.json({ sessions });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(createInterviewSessionSchema, body);
  if ("error" in result) return result.error;
  const input = result.data;

  let pageId: string | null = null;
  let topicText: string | null = null;
  let title: string;
  let context: InterviewContext;

  if (input.source === "LECTURE") {
    const page = await db.page.findUnique({
      where: { id: input.pageId },
      include: { notes: true, transcript: true },
    });
    if (!page) return jsonError("Page not found", 404);

    pageId = page.id;
    title = input.title;
    context = {
      title,
      source: "LECTURE",
      notesMarkdown: page.notes?.markdown ?? null,
      transcriptText: page.transcript?.rawText ?? null,
    };
  } else {
    topicText = input.topicText;
    title = input.title && input.title.trim() ? input.title.trim() : topicText.slice(0, 80);
    context = { title, source: "TOPIC", topicText };
  }

  const session = await db.interviewSession.create({
    data: { title, source: input.source, pageId, topicText },
  });

  try {
    const raw = await callOpenRouterJSON({
      model: MODEL,
      systemPrompt: INTERVIEW_QUESTION_SYSTEM_PROMPT,
      userPrompt: buildFirstQuestionUserPrompt(context),
    });
    const parsed = await interviewQuestionResponseSchema.parseAsync(raw);

    const firstTurn = await db.interviewTurn.create({
      data: { sessionId: session.id, order: 0, question: parsed.question },
    });

    return NextResponse.json({ session, firstTurn });
  } catch (e) {
    await db.interviewSession.delete({ where: { id: session.id } }).catch(() => undefined);
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Failed to start the interview";
    return jsonError(message, 502);
  }
}
