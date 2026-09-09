import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { PRETEST_SYSTEM_PROMPT, buildPretestUserPrompt } from "@/lib/prompts/pretest";
import { pretestResponseSchema } from "@/lib/validation";

const RETRY_MESSAGE = "The model's response didn't match the expected format. You can retry this step.";

/**
 * Generate three prediction questions for a topic, built before the lecture exists.
 * A pretest that can see the lecture is a quiz, not a prediction, so this route
 * loads only the topic and syllabus — nothing else.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; topicId: string }> }
) {
  const { id, topicId } = await params;

  const topic = await db.courseTopic.findUnique({ where: { id: topicId } });
  if (!topic || topic.folderId !== id) return jsonError("Topic not found", 404);

  const syllabus = await db.material.findFirst({
    where: { folderId: id, kind: "SYLLABUS" },
  });
  if (!syllabus) return jsonError("This course has no syllabus to build a pretest from.", 422);

  let parsed;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: PRETEST_SYSTEM_PROMPT,
      userPrompt: buildPretestUserPrompt({
        topicTitle: topic.title,
        syllabusText: syllabus.text,
      }),
    });
    parsed = await pretestResponseSchema.parseAsync(raw);
  } catch (e) {
    const message =
      e instanceof ZodError ? RETRY_MESSAGE : e instanceof Error ? e.message : "Generating the pretest failed";
    return jsonError(message, 502);
  }

  return NextResponse.json({
    topic: { id: topic.id, title: topic.title },
    questions: parsed.questions,
  });
}
