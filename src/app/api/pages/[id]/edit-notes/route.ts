import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMText } from "@/lib/llm";
import { EDIT_NOTES_SYSTEM_PROMPT, buildEditNotesUserPrompt } from "@/lib/prompts/edit-notes";
import { editNotesSchema } from "@/lib/validation";
import { upsertSearchIndex } from "@/lib/fts";
import { indexSourceSafely } from "@/lib/embeddings";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(editNotesSchema, body);
  if ("error" in result) return result.error;

  const page = await db.page.findUnique({ where: { id }, include: { notes: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.notes) return jsonError("This page has no notes to edit yet", 422);

  const model = process.env.OPENROUTER_MODEL_SUMMARY ?? "openrouter/free";

  try {
    const revised = await callLLMText({
      model,
      stage: "summary",
      messages: [
        { role: "system", content: EDIT_NOTES_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildEditNotesUserPrompt({
            markdown: page.notes.markdown,
            instruction: result.data.instruction,
            selectedText: result.data.selectedText,
          }),
        },
      ],
    });

    // Strip a whole-document code fence if a smaller model added one anyway.
    const markdown = revised.replace(/^```(?:markdown|md)?\s*\n/i, "").replace(/\n```\s*$/i, "").trim();
    if (!markdown) throw new Error("The model returned an empty edit. You can retry.");

    // Compare-and-set: the model call can take seconds, and a save, undo or
    // second edit landing in that gap would otherwise be overwritten — with the
    // snapshot pointing past it, so not even Undo could bring it back.
    const { count } = await db.notes.updateMany({
      where: { pageId: id, markdown: page.notes.markdown },
      data: { markdown, previousMarkdown: page.notes.markdown },
    });
    if (count === 0) {
      return jsonError("The notes changed while this edit was running. Nothing was overwritten; try again.", 409);
    }
    await upsertSearchIndex(id);

    await indexSourceSafely({ pageId: id });

    return NextResponse.json({ markdown, canUndo: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Editing the notes failed";
    return jsonError(message, 502);
  }
}
