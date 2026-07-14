import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createPageSchema } from "@/lib/validation";
import { withValidation } from "@/lib/api-utils";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(req: NextRequest) {
  const folderId = req.nextUrl.searchParams.get("folderId");
  const tag = req.nextUrl.searchParams.get("tag");
  const status = req.nextUrl.searchParams.get("status");

  const where: Prisma.PageWhereInput = {};
  if (folderId) where.folderId = folderId;
  if (status) where.status = status as Prisma.PageWhereInput["status"];
  if (tag) where.tags = { some: { tag: { name: tag } } };

  const pages = await db.page.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      folder: true,
      tags: { include: { tag: true } },
      _count: { select: { flashcards: true, quizQuestions: true } },
    },
  });
  return NextResponse.json({ pages });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(createPageSchema, body);
  if ("error" in result) return result.error;

  const page = await db.page.create({ data: result.data });
  return NextResponse.json({ page }, { status: 201 });
}
