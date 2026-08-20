import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Delete directly and treat "already gone" (double-click, second tab) as 404
  // rather than pre-checking, which races.
  try {
    await db.dictionaryTerm.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return jsonError("Term not found", 404);
  }
}
