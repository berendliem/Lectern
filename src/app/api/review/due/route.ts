import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { courseScopeFilter } from "@/lib/cards";

export async function GET(req: NextRequest) {
  const folderId = req.nextUrl.searchParams.get("folderId");
  const pageId = req.nextUrl.searchParams.get("pageId");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(100, Math.max(1, Number(limitParam))) : 20;

  // A lecture is the narrower scope, so it wins when both are sent.
  const where = {
    nextReviewAt: { lte: new Date() },
    ...(pageId ? { pageId } : folderId ? courseScopeFilter(folderId) : {}),
  };

  const [cards, total] = await Promise.all([
    db.flashcard.findMany({
      where,
      orderBy: { nextReviewAt: "asc" },
      take: limit,
      include: {
        page: { select: { id: true, title: true, folder: { select: { name: true } } } },
        material: { select: { id: true, title: true, folder: { select: { name: true } } } },
      },
    }),
    db.flashcard.count({ where }),
  ]);

  return NextResponse.json({ cards, total });
}
