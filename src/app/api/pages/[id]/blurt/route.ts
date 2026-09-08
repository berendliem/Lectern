import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { assertSingleParent } from "@/lib/cards";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { BLURT_SYSTEM_PROMPT, buildBlurtUserPrompt } from "@/lib/prompts/blurt";
import { blurtResponseSchema, blurtSubmitSchema } from "@/lib/validation";
import { recallRow, settleMisconceptions, type RecallEvent } from "@/lib/recall-log";

/** Marks a card as born from a blurt, so a deck shows where it came from. */
const BLURT_SOURCE_TERM = "From a blurt";

/**
 * The student writes what they remember about a lecture, unprompted, and what
 * they missed becomes cards. The cheapest generative surface in the app: one
 * prompt, one write, and it produces exactly the cards they have already
 * demonstrated they need.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(blurtSubmitSchema, body);
  if ("error" in result) return result.error;

  const page = await db.page.findUnique({ where: { id }, include: { notes: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.notes) return jsonError("This lecture has no notes to blurt against yet", 422);

  const { dump } = result.data;

  let parsed;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: BLURT_SYSTEM_PROMPT,
      userPrompt: buildBlurtUserPrompt(page.notes.markdown, dump),
    });
    parsed = await blurtResponseSchema.parseAsync(raw);
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Marking your blurt failed";
    return jsonError(message, 502);
  }

  const event: RecallEvent = {
    raw: { kind: "BLURT", covered: parsed.covered.length, missed: parsed.missed.length },
    pageId: id,
    misconception: parsed.wrong[0]?.correction ?? parsed.missed[0] ?? null,
    detail: {
      covered: parsed.covered.length,
      missed: parsed.missed.length,
      wrong: parsed.wrong.length,
    },
  };

  const cards = [
    ...parsed.missed.map((point) => ({
      prompt: `You didn't mention this when you blurted "${page.title}". Explain it: ${point}`,
      idealExplanation: point,
    })),
    ...parsed.wrong.map((item) => ({
      prompt: `You said: "${item.claim}". Explain what is actually the case.`,
      idealExplanation: item.correction,
    })),
  ];

  // One transaction: cards without the event would schedule work the ledger
  // cannot explain, and an event without its cards loses the only part of a
  // blurt worth keeping.
  await db.$transaction([
    ...(cards.length > 0
      ? [
          db.flashcard.createMany({
            data: cards.map((card) => ({
              ...assertSingleParent({ pageId: id }),
              prompt: card.prompt,
              idealExplanation: card.idealExplanation,
              sourceTerm: BLURT_SOURCE_TERM,
            })),
          }),
        ]
      : []),
    db.reviewLog.create({ data: recallRow(event) }),
  ]);

  // Outside the transaction: closing an older misconception is bookkeeping, and
  // failing at it must not cost the student the cards they just earned.
  const { quality } = await settleMisconceptions(event);

  return NextResponse.json({ feedback: parsed, quality, cardsCreated: cards.length });
}
