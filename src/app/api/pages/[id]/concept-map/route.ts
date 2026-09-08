import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { conceptMapResponseSchema } from "@/lib/validation";
import { CONCEPT_MAP_SYSTEM_PROMPT, buildConceptMapUserPrompt } from "@/lib/prompts/concept-map";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: { transcript: true, notes: true },
  });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript && !page.notes) {
    return jsonError("This page has no transcript or notes to map yet", 422);
  }

  // Prefer notes (already distilled); fall back to the raw transcript.
  const material = page.notes?.markdown ?? page.transcript?.rawText ?? "";

  const model =
    process.env.OPENROUTER_MODEL_CONCEPT_MAP ??
    process.env.OPENROUTER_MODEL_SUMMARY ??
    "openrouter/free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: CONCEPT_MAP_SYSTEM_PROMPT,
      userPrompt: buildConceptMapUserPrompt(page.title, material),
    });
    const parsed = await conceptMapResponseSchema.parseAsync(raw).catch(() => null);
    if (!parsed) {
      return jsonError("The model returned an unexpected concept map. Try again.", 502);
    }

    // Drop edges pointing at unknown nodes rather than failing the whole map.
    const ids = new Set(parsed.nodes.map((n) => n.id));
    const edges = parsed.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

    return NextResponse.json({ conceptMap: { nodes: parsed.nodes, edges } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Concept map generation failed";
    return jsonError(message, 502);
  }
}
