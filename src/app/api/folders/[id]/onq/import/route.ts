import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { indexSourceSafely } from "@/lib/embeddings";
import { MAX_TEXT_CHARS } from "@/lib/limits";
import { readOnqTopic } from "@/lib/mcp/onq";
import { materialFromTopic } from "@/lib/onq-import";
import { importOnqTopicSchema } from "@/lib/validation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(importOnqTopicSchema, body);
  if ("error" in result) return result.error;
  const { topicId, moduleTitle } = result.data;

  const folder = await db.folder.findUnique({ where: { id }, select: { onqCourseId: true } });
  if (!folder) return jsonError("Course not found", 404);
  if (folder.onqCourseId === null) return jsonError("This course is not linked to an onQ course yet.", 409);

  let topic;
  try {
    topic = await readOnqTopic(folder.onqCourseId, topicId);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not read that file from onQ.", 502);
  }

  const made = materialFromTopic(topic, moduleTitle, MAX_TEXT_CHARS);
  if ("skip" in made) return NextResponse.json({ outcome: "skipped", reason: made.skip });
  const { draft } = made;

  const existing = await db.material.findUnique({
    where: { folderId_onqTopicId: { folderId: id, onqTopicId: topicId } },
    select: { id: true },
  });

  // A re-import refreshes what came from onQ and leaves what the student may
  // have edited since — the title and the kind — alone.
  const material = existing
    ? await db.material.update({
        where: { id: existing.id },
        data: { text: draft.text, sourceFileName: draft.sourceFileName, onqLastModified: draft.onqLastModified },
        select: { id: true },
      })
    : await db.material.create({ data: { folderId: id, ...draft }, select: { id: true } });

  await indexSourceSafely({ materialId: material.id });

  return NextResponse.json({ outcome: existing ? "updated" : "imported" });
}
