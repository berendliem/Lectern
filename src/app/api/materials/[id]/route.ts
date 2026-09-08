import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.material.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = await db.material.findUnique({
    where: { id },
    select: { id: true, title: true, text: true },
  });
  if (!material) return jsonError("Material not found", 404);
  return NextResponse.json({ material });
}
