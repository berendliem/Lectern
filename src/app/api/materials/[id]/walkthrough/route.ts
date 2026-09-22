import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { splitSections, splitSlides, type WalkthroughStepSeed } from "@/lib/walkthrough";
import {
  WALKTHROUGH_OUTLINE_SYSTEM_PROMPT,
  buildWalkthroughOutlineUserPrompt,
} from "@/lib/prompts/walkthrough";
import { walkthroughOutlineResponseSchema, walkthroughStepIndexSchema } from "@/lib/validation";

const RETRY_MESSAGE = "The model's response didn't match the expected format. You can retry this step.";

/** Only a deck or a reading is walked: a syllabus is a reference document. */
const WALKABLE: readonly string[] = ["SLIDES", "READING"];

function view(walkthrough: {
  id: string;
  stepIndex: number;
  steps: {
    id: string;
    ordinal: number;
    label: string;
    sourceText: string;
    explanation: string | null;
    recallPrompt: string | null;
  }[];
}) {
  return {
    id: walkthrough.id,
    stepIndex: walkthrough.stepIndex,
    steps: walkthrough.steps.map((step) => ({
      id: step.id,
      ordinal: step.ordinal,
      label: step.label,
      sourceText: step.sourceText,
      explanation: step.explanation,
      recallPrompt: step.recallPrompt,
    })),
  };
}

/**
 * Creates the walkthrough for a material, or returns the one already there.
 *
 * Idempotent on purpose: the button that calls this is the button a student
 * clicks to resume, and rebuilding would silently drop their position and every
 * explanation already paid for.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const material = await db.material.findUnique({
    where: { id },
    include: { walkthrough: { include: { steps: { orderBy: { ordinal: "asc" } } } } },
  });
  if (!material) return jsonError("Material not found", 404);
  if (material.walkthrough) return NextResponse.json({ walkthrough: view(material.walkthrough) });

  if (!WALKABLE.includes(material.kind)) {
    return jsonError("Only slide decks and readings can be walked through", 422);
  }
  if (!material.text.trim()) {
    return jsonError("There is no extracted text in this material to walk through", 422);
  }

  let seeds: WalkthroughStepSeed[] = splitSlides(material.text);
  if (seeds.length === 0) {
    // A reading, or a deck that arrived as flat text with no slide markers.
    let headings: string[];
    try {
      const raw = await callLLMJSON({
        model: reasoningModel(),
        systemPrompt: WALKTHROUGH_OUTLINE_SYSTEM_PROMPT,
        userPrompt: buildWalkthroughOutlineUserPrompt(material.title, material.text),
      });
      headings = (await walkthroughOutlineResponseSchema.parseAsync(raw)).headings;
    } catch (e) {
      const message =
        e instanceof ZodError
          ? RETRY_MESSAGE
          : e instanceof Error
            ? e.message
            : "Planning the walkthrough failed";
      return jsonError(message, 502);
    }
    seeds = splitSections(material.text, headings);
  }
  if (seeds.length === 0) return jsonError("This material has no text to walk through", 422);

  let walkthrough;
  try {
    walkthrough = await db.walkthrough.create({
      data: {
        materialId: id,
        steps: {
          create: seeds.map((seed) => ({
            ordinal: seed.ordinal,
            label: seed.label,
            sourceText: seed.sourceText,
          })),
        },
      },
      include: { steps: { orderBy: { ordinal: "asc" } } },
    });
  } catch (e) {
    // Unique constraint on Walkthrough.materialId: two POSTs raced past the
    // "no walkthrough yet" check above. The loser didn't fail, it just lost —
    // it resumes the winner's walkthrough instead of erroring.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    const existing = await db.walkthrough.findUnique({
      where: { materialId: id },
      include: { steps: { orderBy: { ordinal: "asc" } } },
    });
    if (!existing) return jsonError("Material not found", 404);
    walkthrough = existing;
  }

  return NextResponse.json({ walkthrough: view(walkthrough) });
}

/** Moving without answering: Back, and skipping a step. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(walkthroughStepIndexSchema, body);
  if ("error" in result) return result.error;

  const walkthrough = await db.walkthrough.findUnique({
    where: { materialId: id },
    include: { _count: { select: { steps: true } } },
  });
  if (!walkthrough) return jsonError("This material has no walkthrough yet", 404);

  // Clamped rather than rejected: a stale tab asking for step 40 of a 12-step
  // walkthrough should land on the last step, not throw at the student.
  const stepIndex = Math.min(result.data.stepIndex, Math.max(0, walkthrough._count.steps - 1));
  await db.walkthrough.update({ where: { id: walkthrough.id }, data: { stepIndex } });
  return NextResponse.json({ stepIndex });
}
