import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const { id, tagId } = await params;
  await db.tagsOnPages.delete({ where: { pageId_tagId: { pageId: id, tagId } } }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
