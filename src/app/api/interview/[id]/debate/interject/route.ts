import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { courseGrounding } from "@/lib/course-grounding";
import { STUDENT_SPEAKER, debateTexts, nextOrder, toDebateTurns } from "@/lib/debate";
import {
  INTERJECTION_GRADE_SYSTEM_PROMPT,
  buildInterjectionGradePrompt,
} from "@/lib/prompts/debate";
import { interviewFeedbackResponseSchema } from "@/lib/interview";
import { debateInterjectSchema } from "@/lib/validation";
import { writeRecallSafely } from "@/lib/recall-log";

const GROUNDING_K = 6;

/**
 * Watching a debate writes nothing; taking a side is the recall act. One event
 * per interjection, targeted at the course topic so the scheduler can see it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(debateInterjectSchema, body);
  if ("error" in result) return result.error;
  const { text } = result.data;

  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      topic: { select: { id: true, title: true, folderId: true } },
    },
  });
  if (!session) return jsonError("Interview session not found", 404);
  if (session.mode !== "DEBATE") return jsonError("This session is not a debate", 422);
  if (!session.topic) return jsonError("This debate has no course topic behind it", 422);

  const turns = toDebateTurns(session.turns);

  // The turn lands before the grade: a point the student typed is theirs whether
  // or not the grader is reachable.
  const turn = await db.interviewTurn.create({
    data: {
      sessionId: id,
      order: nextOrder(turns),
      question: "Interjection",
      answer: text,
      speaker: STUDENT_SPEAKER,
    },
  });

  const grounding = await courseGrounding(
    session.topic.folderId,
    session.topic.title,
    GROUNDING_K,
    "debate/interject"
  );

  const texts = debateTexts(session.turns);

  let feedback;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: INTERJECTION_GRADE_SYSTEM_PROMPT,
      userPrompt: buildInterjectionGradePrompt({
        concept: session.topic.title,
        grounding,
        turns,
        texts,
        interjection: text,
      }),
    });
    feedback = await interviewFeedbackResponseSchema.parseAsync(raw);
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. Your point was kept; it just wasn't graded."
        : e instanceof Error
          ? e.message
          : "Your point was kept but could not be graded";
    return NextResponse.json({ turn, feedback: null, error: message });
  }

  await db.interviewTurn.update({
    where: { id: turn.id },
    data: { feedback: JSON.stringify(feedback) },
  });

  await writeRecallSafely({
    raw: { kind: "INTERVIEW", rating: feedback.score },
    topicId: session.topic.id,
    misconception: feedback.improvements[0] ?? null,
    detail: { interjection: text, score: feedback.score, mode: "DEBATE" },
  });

  return NextResponse.json({ turn, feedback });
}
