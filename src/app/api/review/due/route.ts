import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const folderId = req.nextUrl.searchParams.get("folderId");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(100, Math.max(1, Number(limitParam))) : 20;

  const cards = await db.flashcard.findMany({
    where: {
      nextReviewAt: { lte: new Date() },
      ...(folderId ? { page: { folderId } } : {}),
    },
    orderBy: { nextReviewAt: "asc" },
    take: limit,
    include: { page: { select: { id: true, title: true } } },
  });

  return NextResponse.json({ cards });
}
