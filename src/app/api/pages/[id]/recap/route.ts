import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMText } from "@/lib/llm";
import { RECAP_SYSTEM_PROMPT, buildRecapUserPrompt } from "@/lib/prompts/recap";

/**
 * Writes a spoken recap of one lecture. The script is returned and not stored:
 * it is derived entirely from the notes, so regenerating costs one call to a
 * free model and nothing of the student's is lost by not keeping it. Give
 * Notes a recapScript column if the wait ever starts to grate.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: { notes: true, transcript: true },
  });
  if (!page) return jsonError("Page not found", 404);

  // Notes first — already distilled — and the cleaned transcript beats the raw
  // one for anything meant to be read aloud.
  const material = page.notes?.markdown ?? page.transcript?.cleanText ?? page.transcript?.rawText ?? "";
  if (!material.trim()) {
    return jsonError("This page has no notes or transcript to recap yet", 422);
  }

  const model = process.env.OPENROUTER_MODEL_SUMMARY ?? "openrouter/free";

  try {
    const script = await callLLMText({
      model,
      stage: "summary",
      messages: [
        { role: "system", content: RECAP_SYSTEM_PROMPT },
        { role: "user", content: buildRecapUserPrompt(page.title, material) },
      ],
    });

    if (!script.trim()) return jsonError("The model returned an empty recap. Try again.", 502);
    return NextResponse.json({ script: script.trim() });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not write the recap";
    return jsonError(message, 502);
  }
}
