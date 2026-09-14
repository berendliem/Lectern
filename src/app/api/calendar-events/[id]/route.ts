import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { updateCalendarEventSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(updateCalendarEventSchema, body);
  if ("error" in result) return result.error;

  const existing = await db.calendarEvent.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError("Calendar event not found", 404);

  if (result.data.folderId) {
    const folder = await db.folder.findUnique({ where: { id: result.data.folderId }, select: { id: true } });
    if (!folder) return jsonError("Course not found", 404);
  }

  // Pinned from here on: the next sync keeps this choice whatever the
  // classifier says about the same event.
  const event = await db.calendarEvent.update({
    where: { id },
    data: { folderId: result.data.folderId, folderPinned: true },
    include: { folder: { select: { id: true, name: true, color: true } } },
  });
  return NextResponse.json({ event });
}
