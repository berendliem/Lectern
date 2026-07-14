import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createFolderSchema } from "@/lib/validation";
import { withValidation } from "@/lib/api-utils";
import { pickFolderFamily } from "@/lib/folder-colors";

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

  const color = result.data.color ?? pickFolderFamily(await db.folder.count());
  const folder = await db.folder.create({ data: { ...result.data, color } });
  return NextResponse.json({ folder }, { status: 201 });
}
