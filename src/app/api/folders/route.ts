import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createFolderSchema } from "@/lib/validation";
import { withValidation } from "@/lib/api-utils";
import { pickFolderFamily } from "@/lib/folder-colors";
import { courseScopeFilter } from "@/lib/cards";

export async function GET() {
  const folders = await db.folder.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { pages: true } } },
  });
  // One count per course, in parallel: cards reach a course through either
  // the lecture or the material relation, which a single groupBy cannot join.
  // ponytail: N queries for N courses; a raw grouped query if the list grows past dozens.
  const now = new Date();
  const dueCounts = await Promise.all(
    folders.map((folder) =>
      db.flashcard.count({ where: { nextReviewAt: { lte: now }, ...courseScopeFilter(folder.id) } })
    )
  );
  return NextResponse.json({
    folders: folders.map((folder, i) => ({ ...folder, dueCount: dueCounts[i] })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(createFolderSchema, body);
  if ("error" in result) return result.error;

  const color = result.data.color ?? pickFolderFamily(await db.folder.count());
  const folder = await db.folder.create({ data: { ...result.data, color } });
  return NextResponse.json({ folder }, { status: 201 });
}
