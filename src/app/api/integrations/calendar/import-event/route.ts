import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withValidation } from "@/lib/api-utils";

export const runtime = "nodejs";

const importEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  start: z.string().trim().max(64).optional(),
});

// Creates a draft lecture page named after a calendar event, so a student can
// pre-create pages for this week's classes and just hit record in each one.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(importEventSchema, body);
  if ("error" in result) return result.error;

  const { title, start } = result.data;
  const day = start?.slice(0, 10);
  const pageTitle = day ? `${title} — ${day}` : title;

  const existing = await db.page.findFirst({ where: { title: pageTitle } });
  if (existing) return NextResponse.json({ page: existing, existed: true });

  const page = await db.page.create({ data: { title: pageTitle } });
  return NextResponse.json({ page, existed: false }, { status: 201 });
}
