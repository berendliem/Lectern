import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { writeRecallSafely } from "@/lib/recall-log";
import { pretestSubmitSchema } from "@/lib/validation";

/**
 * Accept pretest answers and hold them in ReviewLog until the lecture exists.
 * Returns only the count held, not which were right — that reveal comes later.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; topicId: string }> }
) {
  const { id, topicId } = await params;

  const topic = await db.courseTopic.findUnique({ where: { id: topicId } });
  if (!topic || topic.folderId !== id) return jsonError("Topic not found", 404);

  const body = await req.json();
  const result = await withValidation(pretestSubmitSchema, body);
  if ("error" in result) return result.error;

  // Write one ReviewLog entry per question with the full payload in detail
  for (const answer of result.data.answers) {
    await writeRecallSafely({
      raw: { kind: "PRETEST", correct: answer.chosenIndex === answer.correctIndex },
      topicId,
      detail: {
        prompt: answer.prompt,
        options: answer.options,
        correctIndex: answer.correctIndex,
        chosenIndex: answer.chosenIndex,
        explanation: answer.explanation,
      },
    });
  }

  return NextResponse.json({ held: result.data.answers.length });
}
