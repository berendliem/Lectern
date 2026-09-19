import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { liveInterruptSchema } from "@/lib/live-interview";

/**
 * Where the student cut the tutor off, so the transcript shows what they
 * actually heard. Independent of the reply's own save, so it can land first.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(liveInterruptSchema, body);
  if ("error" in result) return result.error;

  const updated = await db.interviewTurn.updateMany({
    where: { id: result.data.turnId, sessionId: id },
    data: { interruptedAt: result.data.interruptedAt },
  });
  if (updated.count === 0) return jsonError("Turn not found in this session", 404);
  return NextResponse.json({ ok: true });
}
