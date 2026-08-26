import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { buildMarkdownExport } from "@/lib/markdown-export";
import { createNotionPageWithMarkdown, updateNotionPageMarkdown } from "@/lib/mcp/notion";

export const runtime = "nodejs";

// Keep the pushed document a sane size — Notion's markdown update has limits
// and nobody wants a 500KB transcript dumped into a Notion page.
const MAX_TRANSCRIPT_CHARS = 30_000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: {
      transcript: true,
      notes: true,
      flashcards: { orderBy: { createdAt: "asc" } },
      actionItems: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!page) return jsonError("Page not found", 404);
  if (!page.notes && !page.transcript) {
    return jsonError("Transcribe or summarize this page first — there's nothing to sync yet", 422);
  }

  const transcriptText = page.transcript ? (page.transcript.cleanText ?? page.transcript.rawText) : null;
  const truncated = transcriptText && transcriptText.length > MAX_TRANSCRIPT_CHARS;
  let markdown = buildMarkdownExport({
    ...page,
    transcript: transcriptText
      ? { rawText: truncated ? `${transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n*(transcript truncated for Notion)*` : transcriptText }
      : null,
  });

  if (page.actionItems.length > 0) {
    const lines = page.actionItems.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`);
    markdown += `\n\n## Action Items\n${lines.join("\n")}\n`;
  }

  try {
    if (page.notionPageId) {
      await updateNotionPageMarkdown(page.notionPageId, markdown);
      return NextResponse.json({ notionPageId: page.notionPageId, updated: true });
    }

    const { pageId: notionPageId, url } = await createNotionPageWithMarkdown(page.title, markdown);
    await db.page.update({ where: { id }, data: { notionPageId } });
    return NextResponse.json({ notionPageId, url, updated: false });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Syncing to Notion failed", 502);
  }
}
