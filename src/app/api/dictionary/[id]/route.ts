import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.dictionaryTerm.findUnique({ where: { id } });
  if (!existing) return jsonError("Term not found", 404);

  await db.dictionaryTerm.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
