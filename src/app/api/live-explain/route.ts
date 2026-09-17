import { NextRequest, NextResponse } from "next/server";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { cleanMermaid } from "@/lib/mermaid";
import { liveExplainSchema, liveExplainResponseSchema } from "@/lib/validation";
import { WEB_SEARCH_CLAUSE } from "@/lib/prompts/shared";

const SYSTEM_PROMPT = `You are a live study assistant sitting next to a student in a lecture. You receive the most recent stretch of the lecture transcript (raw speech-to-text, possibly with recognition errors). Briefly explain the concept the lecturer is currently talking about, in plain language, as if catching the student up.

Reply with JSON only: {"explanation": string, "diagram": string}.

- "explanation": 2-4 sentences, no preamble, no headings.
- "diagram": Mermaid source for a small diagram that supports the explanation — at most 7 nodes, node labels in plain words. Prefer "flowchart TD" for a process or a relationship, "sequenceDiagram" for an exchange over time. No markdown fences, no styling directives, no parentheses or quotes inside node labels. If the concept is a plain definition with nothing to lay out, use an empty string.`;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(liveExplainSchema, body);
  if ("error" in result) return result.error;

  const model =
    process.env.OPENROUTER_MODEL_CHAT ??
    process.env.OPENROUTER_MODEL_SUMMARY ??
    "openrouter/free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: result.data.web ? `${SYSTEM_PROMPT}\n\n${WEB_SEARCH_CLAUSE}` : SYSTEM_PROMPT,
      userPrompt: `Latest transcript excerpt:\n"""\n${result.data.context}\n"""`,
      web: result.data.web,
    });
    const parsed = await liveExplainResponseSchema.safeParseAsync(raw);
    if (!parsed.success) throw new Error("The model returned no explanation. You can retry this step.");

    return NextResponse.json({
      explanation: parsed.data.explanation,
      diagram: cleanMermaid(parsed.data.diagram),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Explanation failed";
    return jsonError(message, 502);
  }
}
