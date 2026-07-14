import { NextRequest, NextResponse } from "next/server";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callOpenRouterText } from "@/lib/openrouter";
import { liveExplainSchema } from "@/lib/validation";

const SYSTEM_PROMPT = `You are a live study assistant sitting next to a student in a lecture. You receive the most recent stretch of the lecture transcript (raw speech-to-text, possibly with recognition errors). Briefly explain the concept the lecturer is currently talking about, in plain language, as if catching the student up. 2-4 sentences, no preamble, no headings.`;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(liveExplainSchema, body);
  if ("error" in result) return result.error;

  const model =
    process.env.OPENROUTER_MODEL_CHAT ??
    process.env.OPENROUTER_MODEL_SUMMARY ??
    "meta-llama/llama-3.3-70b-instruct:free";

  try {
    const explanation = await callOpenRouterText({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Latest transcript excerpt:\n"""\n${result.data.context}\n"""` },
      ],
    });
    return NextResponse.json({ explanation });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Explanation failed";
    return jsonError(message, 502);
  }
}
