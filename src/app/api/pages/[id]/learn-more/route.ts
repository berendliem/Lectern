import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { learnMoreResponseSchema } from "@/lib/validation";
import { LEARN_MORE_SYSTEM_PROMPT, buildLearnMoreUserPrompt } from "@/lib/prompts/learn-more";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: { transcript: true, notes: true },
  });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript && !page.notes) {
    return jsonError("This page has no transcript or notes to build on yet", 422);
  }

  // Prefer notes (already distilled); fall back to the raw transcript.
  const material = page.notes?.markdown ?? page.transcript?.rawText ?? "";

  const model =
    process.env.OPENROUTER_MODEL_LEARN_MORE ??
    process.env.OPENROUTER_MODEL_SUMMARY ??
    "openrouter/free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: LEARN_MORE_SYSTEM_PROMPT,
      userPrompt: buildLearnMoreUserPrompt(page.title, material),
    });
    const parsed = await learnMoreResponseSchema.parseAsync(raw).catch(() => null);
    if (!parsed) {
      return jsonError("The model returned unexpected suggestions. Try again.", 502);
    }

    // The schema's max is the only cap: a model that returns seven usable
    // suggestions should not have one silently dropped by a second, tighter
    // limit that disagrees with it.
    return NextResponse.json({ learnMore: { items: parsed.items } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Learn more generation failed";
    return jsonError(message, 502);
  }
}
