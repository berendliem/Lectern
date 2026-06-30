import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createFolderSchema } from "@/lib/validation";
import { withValidation } from "@/lib/api-utils";

export async function GET() {
  const folders = await db.folder.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { pages: true } } },
  });
  return NextResponse.json({ folders });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(createFolderSchema, body);
  if ("error" in result) return result.error;

  const folder = await db.folder.create({ data: result.data });
  return NextResponse.json({ folder }, { status: 201 });
}
