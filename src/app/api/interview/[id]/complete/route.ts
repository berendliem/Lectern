import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.interviewSession.findUnique({ where: { id } });
  if (!session) return jsonError("Interview session not found", 404);

  const updated = await db.interviewSession.update({ where: { id }, data: { status: "COMPLETED" } });
  return NextResponse.json({ session: updated });
}
