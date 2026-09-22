import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { assertSingleParent } from "@/lib/cards";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import {
  WALKTHROUGH_RECALL_SYSTEM_PROMPT,
  buildWalkthroughRecallUserPrompt,
} from "@/lib/prompts/walkthrough";
import { normalizeQuality } from "@/lib/recall";
import { recallRow, settleMisconceptions, type RecallEvent } from "@/lib/recall-log";
import { walkthroughRecallResponseSchema, walkthroughRecallSubmitSchema } from "@/lib/validation";
import { WALKTHROUGH_SOURCE_TERM } from "@/lib/walkthrough";

const RETRY_MESSAGE = "The model's response didn't match the expected format. You can retry this step.";

/**
 * The student answers the step's question from memory, before reading the
 * explanation again. What the question required and they missed becomes cards,
 * the attempt becomes one ledger row, and the walkthrough moves on.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(walkthroughRecallSubmitSchema, body);
  if ("error" in result) return result.error;

  const step = await db.walkthroughStep.findUnique({
    where: { id: stepId },
    include: {
      walkthrough: {
        include: { material: { select: { title: true } }, _count: { select: { steps: true } } },
      },
    },
  });
  if (!step || step.walkthrough.materialId !== id) return jsonError("Step not found", 404);
  const { explanation, recallPrompt } = step;
  if (!explanation || !recallPrompt) return jsonError("This step hasn't been written yet", 409);

  let parsed;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: WALKTHROUGH_RECALL_SYSTEM_PROMPT,
      userPrompt: buildWalkthroughRecallUserPrompt(
        step.sourceText,
        explanation,
        recallPrompt,
        result.data.answer
      ),
    });
    parsed = await walkthroughRecallResponseSchema.parseAsync(raw);
  } catch (e) {
    const message =
      e instanceof ZodError
        ? RETRY_MESSAGE
        : e instanceof Error
          ? e.message
          : "Marking your answer failed";
    return jsonError(message, 502);
  }

  const event: RecallEvent = {
    raw: {
      kind: "WALKTHROUGH",
      covered: parsed.covered.length,
      missed: parsed.missed.length,
      wrong: parsed.wrong.length,
    },
    materialId: id,
    misconception: parsed.wrong[0]?.correction ?? parsed.missed[0] ?? null,
    detail: {
      stepId: step.id,
      step: step.label,
      covered: parsed.covered.length,
      missed: parsed.missed.length,
      wrong: parsed.wrong.length,
    },
  };

  const where = `${step.label} of "${step.walkthrough.material.title}"`;
  const candidates = [
    ...parsed.missed.map((point) => ({
      prompt: `You didn't mention this in ${where}. Explain it: ${point}`,
      idealExplanation: point,
    })),
    ...parsed.wrong.map((item) => ({
      prompt: `In ${where}, you said: "${item.claim}". Explain what is actually the case.`,
      idealExplanation: item.correction,
    })),
  ];

  // Revisiting a step asks again, so the same miss comes back on every visit;
  // a card the material already has is not made twice.
  const seen = new Set(
    (
      await db.flashcard.findMany({
        where: {
          materialId: id,
          idealExplanation: { in: candidates.map((card) => card.idealExplanation) },
        },
        select: { idealExplanation: true },
      })
    ).map((card) => card.idealExplanation)
  );
  const cards = candidates.filter((card) => {
    if (seen.has(card.idealExplanation)) return false;
    seen.add(card.idealExplanation);
    return true;
  });

  // Advancing is part of the same write: a student whose answer was graded and
  // whose cards were made should not land back on the step they just finished.
  const stepIndex = Math.min(step.ordinal + 1, Math.max(0, step.walkthrough._count.steps - 1));

  // One transaction, for the reason the blurt route gives: cards without the
  // event would schedule work the ledger cannot explain, and an event without
  // its cards loses the only part of the attempt worth keeping.
  await db.$transaction([
    ...(cards.length > 0
      ? [
          db.flashcard.createMany({
            data: cards.map((card) => ({
              ...assertSingleParent({ materialId: id }),
              prompt: card.prompt,
              idealExplanation: card.idealExplanation,
              sourceTerm: WALKTHROUGH_SOURCE_TERM,
            })),
          }),
        ]
      : []),
    db.reviewLog.create({ data: recallRow(event) }),
    db.walkthrough.update({ where: { id: step.walkthroughId }, data: { stepIndex } }),
  ]);

  // Outside the transaction, and caught: everything above is committed by now,
  // so a bookkeeping failure must not tell the student nothing was saved.
  const quality = normalizeQuality(event.raw);
  try {
    await settleMisconceptions(event);
  } catch (e) {
    console.error(
      `[recall] settling misconceptions after a walkthrough step on material ${id} failed:`,
      e
    );
  }

  return NextResponse.json({ feedback: parsed, quality, cardsCreated: cards.length, stepIndex });
}
