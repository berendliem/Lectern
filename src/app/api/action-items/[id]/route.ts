import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { toggleActionItemSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(toggleActionItemSchema, body);
  if ("error" in result) return result.error;

  const existing = await db.actionItem.findUnique({ where: { id } });
  if (!existing) return jsonError("Action item not found", 404);

  const item = await db.actionItem.update({ where: { id }, data: { done: result.data.done } });
  return NextResponse.json({ item });
}
