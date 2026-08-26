import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { CHAPTERS_SYSTEM_PROMPT, buildChaptersUserPrompt } from "@/lib/prompts/chapters";
import { chaptersResponseSchema } from "@/lib/validation";
import type { Chapter, TranscriptSegment } from "@/types";

const MAX_OUTLINE_CHARS = 24_000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { transcript: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript) return jsonError("This page has no transcript yet", 422);

  const segments: TranscriptSegment[] = JSON.parse(page.transcript.segments);
  if (segments.length < 4) {
    return jsonError("This transcript is too short to divide into chapters", 422);
  }

  // Build "[seconds] text" lines; downsample evenly if the outline would
  // overflow the context budget (chaptering needs coverage, not every word).
  let step = 1;
  let outline = "";
  do {
    const lines: string[] = [];
    for (let i = 0; i < segments.length; i += step) {
      lines.push(`[${Math.round(segments[i].start)}] ${segments[i].text}`);
    }
    outline = lines.join("\n");
    step *= 2;
  } while (outline.length > MAX_OUTLINE_CHARS && step <= 64);

  const model = process.env.OPENROUTER_MODEL_SUMMARY ?? "meta-llama/llama-3.3-70b-instruct:free";
  const lastEnd = segments[segments.length - 1].end;

  try {
    const raw = await callLLMJSON({
      model,
      stage: "summary",
      systemPrompt: CHAPTERS_SYSTEM_PROMPT,
      userPrompt: buildChaptersUserPrompt(outline),
    });
    const parsed = await chaptersResponseSchema.parseAsync(raw);

    // Normalize: clamp into range, sort, drop boundaries closer than 20s to
    // the previous one, then derive each chapter's end from the next start.
    const starts = parsed.chapters
      .map((c) => ({ title: c.title, startSec: Math.min(Math.max(c.startSec, 0), lastEnd) }))
      .sort((a, b) => a.startSec - b.startSec)
      .filter((c, i, arr) => i === 0 || c.startSec - arr[i - 1].startSec >= 20);
    if (starts.length > 0) starts[0].startSec = 0;

    const chapters: Chapter[] = starts.map((c, i) => ({
      ...c,
      endSec: i + 1 < starts.length ? starts[i + 1].startSec : lastEnd,
    }));

    await db.transcript.update({ where: { pageId: id }, data: { chapters: JSON.stringify(chapters) } });

    return NextResponse.json({ chapters });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Chapter detection failed";
    return jsonError(message, 502);
  }
}
