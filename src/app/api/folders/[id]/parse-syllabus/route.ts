import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { SYLLABUS_SYSTEM_PROMPT, buildSyllabusUserPrompt } from "@/lib/prompts/syllabus";
import { syllabusTopicsResponseSchema } from "@/lib/validation";

// One syllabus, one prompt. A syllabus longer than this is a course handbook;
// its topic outline is in the first pages either way, and a free reasoning
// model will simply fail on the whole thing.
const MAX_PROMPT_CHARS = 24_000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folder = await db.folder.findUnique({ where: { id }, select: { id: true } });
  if (!folder) return jsonError("Course not found", 404);

  const syllabus = await db.material.findFirst({
    where: { folderId: id, kind: "SYLLABUS" },
    orderBy: { createdAt: "desc" },
    select: { id: true, text: true },
  });
  if (!syllabus) return jsonError("Upload a syllabus to this course first", 422);
  if (!syllabus.text.trim()) return jsonError("That syllabus has no text to parse", 422);

  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: SYLLABUS_SYSTEM_PROMPT,
      userPrompt: buildSyllabusUserPrompt(syllabus.text.slice(0, MAX_PROMPT_CHARS)),
      stage: "reasoning",
    });
    const parsed = await syllabusTopicsResponseSchema.parseAsync(raw);
    if (parsed.topics.length === 0) {
      return jsonError("The model found no topics in that syllabus — you can add them by hand", 422);
    }

    // A re-parse replaces the outline wholesale, hand edits included. Parsing
    // is an explicit button, never automatic, so this can't silently discard
    // someone's corrections.
    await db.$transaction([
      db.courseTopic.deleteMany({ where: { folderId: id } }),
      db.courseTopic.createMany({
        data: parsed.topics.map((topic, i) => ({
          folderId: id,
          title: topic.title,
          week: topic.week ?? null,
          order: i,
          sourceMaterialId: syllabus.id,
        })),
      }),
    ]);

    return NextResponse.json({ count: parsed.topics.length });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Syllabus parsing failed";
    return jsonError(message, 502);
  }
}
