import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { onqCourseContent } from "@/lib/mcp/onq";
import { annotateTree } from "@/lib/onq-import";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folder = await db.folder.findUnique({ where: { id }, select: { onqCourseId: true } });
  if (!folder) return jsonError("Course not found", 404);
  // 409, not 404: the course exists, it just has no onQ course yet. The
  // dialog reads this status as "show the course picker".
  if (folder.onqCourseId === null) return jsonError("This course is not linked to an onQ course yet.", 409);

  let modules;
  try {
    modules = await onqCourseContent(folder.onqCourseId);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not reach onQ.", 502);
  }

  const existing = await db.material.findMany({
    where: { folderId: id, onqTopicId: { not: null } },
    select: { onqTopicId: true, onqLastModified: true },
  });
  return NextResponse.json({ modules: annotateTree(modules, existing) });
}
