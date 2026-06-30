import type { KeyTerm } from "@/types";

export type ExportablePage = {
  title: string;
  transcript: { rawText: string } | null;
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

  return sections.join("\n\n") + "\n";
}
