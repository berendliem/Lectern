import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { ACTION_ITEMS_SYSTEM_PROMPT, buildActionItemsUserPrompt } from "@/lib/prompts/action-items";
import { actionItemsResponseSchema } from "@/lib/validation";

// Same cap the chat route uses: keeps one request from shipping a
// half-megabyte transcript to the model.
const MAX_CONTEXT_CHARS = 24_000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const items = await db.actionItem.findMany({
    where: { pageId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ items });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { transcript: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript) return jsonError("This page has no transcript to extract from yet", 422);

  const model = process.env.OPENROUTER_MODEL_SUMMARY ?? "meta-llama/llama-3.3-70b-instruct:free";

  try {
    const raw = await callLLMJSON({
      model,
      stage: "summary",
      systemPrompt: ACTION_ITEMS_SYSTEM_PROMPT,
      userPrompt: buildActionItemsUserPrompt(
        (page.transcript.cleanText ?? page.transcript.rawText).slice(0, MAX_CONTEXT_CHARS)
      ),
    });
    const parsed = await actionItemsResponseSchema.parseAsync(raw);

    // Regenerate, but keep the done-state of items whose text is unchanged.
    const previous = await db.actionItem.findMany({ where: { pageId: id } });
    const keyOf = (kind: string, text: string) => JSON.stringify([kind, text]);
    const doneByKey = new Map(previous.map((i) => [keyOf(i.kind, i.text), i.done]));

    const items = await db.$transaction(async (tx) => {
      await tx.actionItem.deleteMany({ where: { pageId: id } });
      for (const item of parsed.items) {
        await tx.actionItem.create({
          data: {
            pageId: id,
            kind: item.kind,
            text: item.text,
            done: doneByKey.get(keyOf(item.kind, item.text)) ?? false,
          },
        });
      }
      return tx.actionItem.findMany({ where: { pageId: id }, orderBy: { createdAt: "asc" } });
    });

    return NextResponse.json({ items });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Action-item extraction failed";
    return jsonError(message, 502);
  }
}
