import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { searchCourse } from "@/lib/embeddings";
import { dropUnbackedChecks, lessonOutlineResponseSchema, lessonScenesResponseSchema, openOnRecall } from "@/lib/lesson";
import {
  LESSON_OUTLINE_SYSTEM_PROMPT,
  LESSON_SCENES_SYSTEM_PROMPT,
  buildLessonOutlineUserPrompt,
  buildLessonScenesUserPrompt,
} from "@/lib/prompts/lesson";

/** How many course chunks ground each stage. */
const GROUNDING_K = 8;

const RETRY_MESSAGE = "The model's response didn't match the expected format. You can retry this step.";

/**
 * A recitation lesson: an outline turned into scenes, generated fresh on every
 * request. Nothing here is persisted — only the recall events the rendered
 * scenes go on to produce (in other routes) survive.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; topicId: string }> }
) {
  const { id, topicId } = await params;

  const topic = await db.courseTopic.findUnique({ where: { id: topicId } });
  if (!topic || topic.folderId !== id) return jsonError("Topic not found", 404);

  const hits = await searchCourse(id, topic.title, GROUNDING_K);
  const grounding = hits.map((hit) => ({ title: hit.title, text: hit.text }));

  let beats;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: LESSON_OUTLINE_SYSTEM_PROMPT,
      userPrompt: buildLessonOutlineUserPrompt({ topicTitle: topic.title, grounding }),
    });
    beats = (await lessonOutlineResponseSchema.parseAsync(raw)).beats;
  } catch (e) {
    const message =
      e instanceof ZodError ? RETRY_MESSAGE : e instanceof Error ? e.message : "Planning the lesson failed";
    return jsonError(message, 502);
  }

  const best = hits[0] ?? null;
  const quizQuestion =
    best && (best.pageId || best.materialId)
      ? await db.quizQuestion.findFirst({
          where: best.pageId ? { pageId: best.pageId } : { materialId: best.materialId as string },
          orderBy: { createdAt: "desc" },
        })
      : null;

  let parsed;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: LESSON_SCENES_SYSTEM_PROMPT,
      userPrompt: buildLessonScenesUserPrompt({
        topicTitle: topic.title,
        beats,
        grounding,
        hasQuizQuestion: quizQuestion !== null,
      }),
    });
    parsed = await lessonScenesResponseSchema.parseAsync(raw);
  } catch (e) {
    const message =
      e instanceof ZodError ? RETRY_MESSAGE : e instanceof Error ? e.message : "Writing the lesson scenes failed";
    return jsonError(message, 502);
  }

  let scenes;
  try {
    // Drop first, hoist second: hoisting before dropping could leave a
    // four-scene lesson at three, and openOnRecall must see the final list.
    scenes = openOnRecall(dropUnbackedChecks(parsed.scenes, quizQuestion !== null));
  } catch (e) {
    const message =
      e instanceof ZodError ? RETRY_MESSAGE : e instanceof Error ? e.message : "Processing the lesson structure failed";
    return jsonError(message, 502);
  }

  return NextResponse.json({
    topic: { id: topic.id, title: topic.title },
    pageId: best?.pageId ?? null,
    scenes,
    quizQuestion,
  });
}
