import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { buildMarkdownExport } from "@/lib/markdown-export";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: { transcript: true, notes: true, flashcards: { orderBy: { createdAt: "asc" } } },
  });
  if (!page) return jsonError("Page not found", 404);

  const markdown = buildMarkdownExport(page);
  const filename = `${page.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "notes"}.md`;

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
