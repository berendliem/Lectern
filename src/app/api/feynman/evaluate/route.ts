import { NextRequest, NextResponse } from "next/server";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { feynmanEvaluateSchema, feynmanFeedbackSchema } from "@/lib/validation";
import { FEYNMAN_SYSTEM_PROMPT, buildFeynmanUserPrompt } from "@/lib/prompts/feynman";
import { writeRecallSafely } from "@/lib/recall-log";

const MODEL =
  process.env.OPENROUTER_MODEL_FEYNMAN ??
  process.env.OPENROUTER_MODEL_CHAT ??
  process.env.OPENROUTER_MODEL_SUMMARY ??
  "openrouter/free";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(feynmanEvaluateSchema, body);
  if ("error" in result) return result.error;

  const { concept, reference, explanation, priorExplanations, pageId } = result.data;

  const userPrompt = buildFeynmanUserPrompt({
    concept,
    reference,
    explanation,
    priorExplanations: priorExplanations ?? [],
  });

  try {
    const raw = await callLLMJSON({ model: MODEL, systemPrompt: FEYNMAN_SYSTEM_PROMPT, userPrompt });
    const parsed = await feynmanFeedbackSchema.parseAsync(raw).catch(() => null);
    if (!parsed) {
      return jsonError("The coach returned an unexpected response. Please try again.", 502);
    }
    // Clamp to an integer score for a clean UI.
    const score = Math.round(parsed.score);

    // Without a pageId the attempt still counts toward the streak and the
    // calibration report; it just has no card to reach.
    await writeRecallSafely({
      raw: { kind: "FEYNMAN", score },
      pageId,
      misconception: parsed.gaps[0] ?? null,
      detail: { concept, score, gaps: parsed.gaps },
    });

    return NextResponse.json({ feedback: { ...parsed, score } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Evaluation failed";
    return jsonError(message, 502);
  }
}
