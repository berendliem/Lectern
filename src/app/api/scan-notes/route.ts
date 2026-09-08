import { NextRequest, NextResponse } from "next/server";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMVision, visionModelLabel } from "@/lib/llm";
import { buildHandwritingUserPrompt, HANDWRITING_SYSTEM_PROMPT } from "@/lib/prompts/handwriting";
import { scanNotesSchema } from "@/lib/validation";

/**
 * Reads one photographed page of notes and returns its Markdown. Stateless on
 * purpose: the browser posts a page, gets text back, and only the text the
 * user then accepts is written — as a material, through the existing create
 * route. Nothing here touches the database, and the image is never stored.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(scanNotesSchema, body);
  if ("error" in result) return result.error;

  try {
    const text = await callLLMVision({
      systemPrompt: HANDWRITING_SYSTEM_PROMPT,
      userPrompt: buildHandwritingUserPrompt(result.data.pageLabel ?? null),
      images: [result.data.image],
    });

    const cleaned = stripFence(text);
    if (!cleaned) {
      return jsonError(
        "The model returned nothing for that page. If this keeps happening, check that OPENROUTER_MODEL_VISION names a model that accepts images.",
        502
      );
    }

    return NextResponse.json({ text: cleaned, modelUsed: visionModelLabel() });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not read that page.";
    return jsonError(message, 502);
  }
}

/** Some models wrap the whole transcription in ```markdown … ``` despite being
 *  told not to; the fence would otherwise be saved as part of the note. */
function stripFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-z]*\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}
