import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { toggleActionItemSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(toggleActionItemSchema, body);
  if ("error" in result) return result.error;

  // No findUnique pre-check: the item can vanish between check and update
  // (a concurrent regenerate replaces all rows), so handle P2025 directly.
  try {
    const item = await db.actionItem.update({ where: { id }, data: { done: result.data.done } });
    return NextResponse.json({ item });
  } catch {
    return jsonError("Action item not found — the list may have been regenerated", 404);
  }
}
