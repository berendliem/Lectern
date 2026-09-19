// src/lib/live-transcript.ts
import { STUDENT_SPEAKER } from "@/lib/debate";
import { readLiveFeedback, type TranscriptSource, type Verdict } from "@/lib/live-interview";

export type TranscriptTurn = {
  id: string;
  order: number;
  speaker: string | null;
  question: string;
  answer: string | null;
  feedback: string | null;
  spoken: string | null;
  interruptedAt: number | null;
  retryOf: string | null;
};

export type TranscriptLine = { speaker: string; text: string; interrupted: boolean; source?: TranscriptSource };

export type FixCard = {
  question: string;
  answer: string;
  correction: string;
  example: string;
  retry: { answer: string; verdict: Verdict } | null;
};

export function tutorName(mode: "VIVA" | "PROTEGE" | "DEBATE"): string {
  return mode === "PROTEGE" ? "Classmate" : "Tutor";
}

/** What the student actually heard: the text up to where they cut in. */
function heard(text: string, interruptedAt: number | null): { text: string; interrupted: boolean } {
  return interruptedAt === null
    ? { text, interrupted: false }
    : { text: text.slice(0, interruptedAt).trimEnd(), interrupted: true };
}

export function transcriptLines(turns: TranscriptTurn[], tutor: string): TranscriptLine[] {
  const sorted = [...turns].sort((a, b) => a.order - b.order);
  const lines: TranscriptLine[] = [];
  sorted.forEach((t, i) => {
    if (t.speaker === STUDENT_SPEAKER) {
      if (t.answer) lines.push({ speaker: "You", text: t.answer, interrupted: false });
      return;
    }
    if (t.speaker !== null) {
      // A debate agent cut off before its first word said nothing the student heard.
      const agent = heard(t.question, t.interruptedAt);
      if (agent.text) lines.push({ speaker: t.speaker, ...agent });
      return;
    }
    const previous = sorted[i - 1];
    if (!previous || previous.spoken === null) {
      lines.push({ speaker: tutor, text: t.question, interrupted: false });
    }
    if (t.answer !== null) {
      lines.push({
        speaker: "You",
        text: t.answer,
        interrupted: false,
        source: readLiveFeedback(t.feedback)?.transcriptSource,
      });
    }
    if (t.spoken !== null) lines.push({ speaker: tutor, ...heard(t.spoken, t.interruptedAt) });
  });
  return lines;
}

/** Every missed first attempt, with its correction, example, and how the retry went. */
export function fixCards(turns: TranscriptTurn[]): FixCard[] {
  const retries = new Map(turns.filter((t) => t.retryOf !== null).map((t) => [t.retryOf as string, t]));
  return [...turns]
    .sort((a, b) => a.order - b.order)
    .flatMap((t) => {
      if (t.answer === null || t.retryOf !== null) return [];
      const feedback = readLiveFeedback(t.feedback);
      if (!feedback || feedback.verdict === "right") return [];
      const retry = retries.get(t.id);
      const retryFeedback = retry ? readLiveFeedback(retry.feedback) : null;
      return [
        {
          question: t.question,
          answer: t.answer,
          correction: feedback.correction,
          example: feedback.example,
          retry:
            retry && retry.answer !== null && retryFeedback
              ? { answer: retry.answer, verdict: retryFeedback.verdict }
              : null,
        },
      ];
    });
}

export function transcriptMarkdown(title: string, lines: TranscriptLine[], cards: FixCard[]): string {
  const conversation = lines.map((l) => {
    const cut = l.interrupted ? " — (you cut in)" : "";
    const source = l.source === "browser" ? " _(browser transcript)_" : "";
    return `**${l.speaker}:** ${l.text}${cut}${source}`;
  });
  const fixes =
    cards.length === 0
      ? ["Nothing to fix — every answer landed."]
      : cards.map((c, i) =>
          [
            `### ${i + 1}. ${c.question}`,
            `- **You said:** ${c.answer}`,
            c.correction ? `- **Correction:** ${c.correction}` : "",
            c.example ? `- **Example:** ${c.example}` : "",
            c.retry ? `- **Retry:** ${c.retry.answer} (${c.retry.verdict})` : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
  return [`# ${title}`, "## Conversation", conversation.join("\n\n"), "## What to fix", fixes.join("\n\n")].join("\n\n") + "\n";
}
