import { contextKind } from "@/lib/transcript-layer";
import type { KeyTerm } from "@/types";

export type ExportablePage = {
  title: string;
  /** The context layer is optional: callers that only hand over the spoken text
   *  (the Notion sync) export the transcript alone, as they always have. */
  transcript: { rawText: string; contextText?: string | null; contextSource?: string | null } | null;
  notes: { markdown: string; keyTerms: string } | null;
  flashcards: { prompt: string; idealExplanation: string }[];
};

export function buildMarkdownExport(page: ExportablePage): string {
  const sections: string[] = [`# ${page.title}`];

  if (page.notes) {
    sections.push(page.notes.markdown.trim());

    const keyTerms: KeyTerm[] = JSON.parse(page.notes.keyTerms);
    if (keyTerms.length > 0) {
      sections.push(
        ["## Key Terms", ...keyTerms.map((kt) => `- **${kt.term}**: ${kt.definition}`)].join("\n")
      );
    }
  }

  if (page.flashcards.length > 0) {
    sections.push(
      [
        "## Flashcards",
        ...page.flashcards.map((card) => `- **Q:** ${card.prompt}\n  **A:** ${card.idealExplanation}`),
      ].join("\n")
    );
  }

  if (page.transcript) {
    sections.push(["## Transcript", page.transcript.rawText.trim()].join("\n\n"));
  }

  // The slides or reading the lecture was taught over. A recording moves the
  // user's imported text down here, and this export is the only way to read it
  // back out of the app.
  if (page.transcript?.contextText) {
    const heading = contextKind(page.transcript.contextSource) === "slides" ? "Slides" : "Reading";
    sections.push([`## ${heading} this lecture was taught over`, page.transcript.contextText.trim()].join("\n\n"));
  }

  return sections.join("\n\n") + "\n";
}
