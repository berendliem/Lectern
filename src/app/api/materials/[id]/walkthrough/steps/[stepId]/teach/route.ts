import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { toStepView } from "@/lib/walkthrough";
import {
  WALKTHROUGH_TEACH_SYSTEM_PROMPT,
  buildWalkthroughTeachUserPrompt,
} from "@/lib/prompts/walkthrough";
import { walkthroughTeachResponseSchema } from "@/lib/validation";

const RETRY_MESSAGE = "The model's response didn't match the expected format. You can retry this step.";

/**
 * Writes one step's explanation and recall prompt, once, and caches them on the
 * row. Called on arriving at a step, so a deck costs one completion per slide
 * actually reached rather than one per slide in the file.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await params;

  const step = await db.walkthroughStep.findUnique({
    where: { id: stepId },
    include: { walkthrough: { include: { material: { select: { title: true, kind: true } } } } },
  });
  // The material in the path must own the step: otherwise a step id from one
  // course could be taught under another material's text.
  if (!step || step.walkthrough.materialId !== id) return jsonError("Step not found", 404);

  if (step.explanation && step.recallPrompt) return NextResponse.json({ step: toStepView(step) });

  let parsed;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: WALKTHROUGH_TEACH_SYSTEM_PROMPT,
      userPrompt: buildWalkthroughTeachUserPrompt({
        materialTitle: step.walkthrough.material.title,
        kind: step.walkthrough.material.kind === "SLIDES" ? "SLIDES" : "READING",
        label: step.label,
        sourceText: step.sourceText,
      }),
    });
    parsed = await walkthroughTeachResponseSchema.parseAsync(raw);
  } catch (e) {
    const message =
      e instanceof ZodError
        ? RETRY_MESSAGE
        : e instanceof Error
          ? e.message
          : "Writing this step failed";
    return jsonError(message, 502);
  }

  const updated = await db.walkthroughStep.update({
    where: { id: stepId },
    data: { explanation: parsed.explanation, recallPrompt: parsed.recallPrompt },
  });

  return NextResponse.json({ step: toStepView(updated) });
}
