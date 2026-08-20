import { NextRequest, NextResponse } from "next/server";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { copilotSuggestionSchema, suggestRequestSchema, SUGGEST_TRANSCRIPT_CHARS } from "@/lib/copilot";
import { buildCopilotUserPrompt, COPILOT_SYSTEM_PROMPT } from "@/lib/prompts/copilot";

const MODEL =
  process.env.OPENROUTER_MODEL_COPILOT ?? process.env.OPENROUTER_MODEL_SUMMARY ?? "meta-llama/llama-3.3-70b-instruct:free";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(suggestRequestSchema, body);
  if ("error" in result) return result.error;

  const transcript = result.data.transcript.slice(-SUGGEST_TRANSCRIPT_CHARS);

  try {
    const raw = await callLLMJSON({
      model: MODEL,
      systemPrompt: COPILOT_SYSTEM_PROMPT,
      userPrompt: buildCopilotUserPrompt(transcript),
    });

    const parsed = copilotSuggestionSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError("The model returned suggestions in an unexpected format. You can retry.", 502);
    }

    return NextResponse.json(parsed.data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not generate suggestions.";
    return jsonError(message, 502);
  }
}
