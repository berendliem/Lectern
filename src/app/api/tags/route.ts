import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tagOnPageSchema } from "@/lib/validation";
import { withValidation, jsonError } from "@/lib/api-utils";

export async function GET() {
  const tags = await db.tag.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ tags });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(tagOnPageSchema, body);
  if ("error" in result) return result.error;
  const { pageId, tagName } = result.data;

  const page = await db.page.findUnique({ where: { id: pageId } });
  if (!page) return jsonError("Page not found", 404);

  const tag = await db.tag.upsert({
    where: { name: tagName },
    update: {},
    create: { name: tagName },
  });

  await db.tagsOnPages.upsert({
    where: { pageId_tagId: { pageId, tagId: tag.id } },
    update: {},
    create: { pageId, tagId: tag.id },
  });

  return NextResponse.json({ tag }, { status: 201 });
}
