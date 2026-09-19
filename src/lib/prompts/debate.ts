// Two agents argue one course concept, grounded in what the course actually
// captured. Judging two plausible arguments is a retrieval task disguised as a
// spectator sport — it surfaces exactly the distinctions notes gloss over.

import { LIVE_GRADE_CLAUSE, LIVE_TUTOR_RULES, UNTRUSTED_CONTENT_CLAUSE, sanitizeUntrusted } from "@/lib/prompts/shared";
import type { Verdict } from "@/lib/live-interview";
import { DEBATE_AGENTS, type DebateTurn } from "@/lib/debate";

const BRIEFS: Record<string, string> = {
  [DEBATE_AGENTS[0]]:
    "You argue FOR the position under debate. You are confident, concrete, and you cite the course material by name when it supports you.",
  [DEBATE_AGENTS[1]]:
    "You argue AGAINST the position under debate. You look for the case the other side is glossing over: edge cases, assumptions, and places the course material is narrower than the claim.",
};

export const DEBATE_SYSTEM_PROMPT = `You are one voice in a two-sided academic debate held in front of a student. Speak in 2-4 sentences — this is a debate, not a lecture. Address the other side's last point directly rather than restating your own. Never break character, and never address the student unless they have just interjected.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{ "utterance": string }

${UNTRUSTED_CONTENT_CLAUSE}`;

export const DEBATE_LIVE_SYSTEM_PROMPT = `You are one voice in a two-sided academic debate held out loud in front of a student. Speak in 2-4 sentences — this is a debate, not a lecture. Address the other side's last point directly rather than restating your own. Never break character, and never address the student unless they have just interjected.

${LIVE_TUTOR_RULES}

Reply with only the words you say.

${UNTRUSTED_CONTENT_CLAUSE} ${LIVE_GRADE_CLAUSE}`;

export type DebateGrounding = { title: string; text: string }[];

function pendingInstruction(
  pending: DebateTurn,
  live: { pendingGrade: { verdict: Verdict; correction: string } | null } | undefined
): string {
  const quoted = `THE STUDENT JUST INTERJECTED:\n"""\n${sanitizeUntrusted(pending.answer ?? "")}\n"""`;
  const grade = live?.pendingGrade;
  if (!grade) return `${quoted}\nAnswer their point first, in your own voice, then continue your argument.`;
  if (grade.verdict === "right") {
    return `${quoted}\nTheir point is right. Concede it briefly in your own voice, then continue your argument.`;
  }
  return `${quoted}\nTheir point is wrong or incomplete. What's off: ${sanitizeUntrusted(grade.correction)}\nCorrect them in your own voice with one concrete example from the course material, then continue your argument.`;
}

export function renderSources(grounding: DebateGrounding): string {
  return grounding
    .map((g, i) => `[${i + 1}] ${sanitizeUntrusted(g.title)}\n"""\n${sanitizeUntrusted(g.text.slice(0, 1200))}\n"""`)
    .join("\n\n");
}

function renderTranscript(turns: DebateTurn[], texts: Map<number, string>): string {
  return [...turns]
    .sort((a, b) => a.order - b.order)
    .map((t) => `${t.speaker}: ${sanitizeUntrusted(texts.get(t.order) ?? "")}`)
    .join("\n\n");
}

export function buildDebateUtterancePrompt(opts: {
  speaker: string;
  concept: string;
  persona: string | null;
  grounding: DebateGrounding;
  turns: DebateTurn[];
  texts: Map<number, string>;
  pending: DebateTurn | null;
  /** Spoken debate: plain text out, and the interjection's grade decides whether to correct or concede. */
  live?: { pendingGrade: { verdict: Verdict; correction: string } | null };
}): string {
  const sources = renderSources(opts.grounding);

  return [
    `YOU ARE: ${opts.speaker}. ${BRIEFS[opts.speaker] ?? ""}`,
    opts.persona ? `THE BRIEF FOR THIS DEBATE: ${opts.persona}` : "",
    `THE POSITION UNDER DEBATE: "${opts.concept}"`,
    sources
      ? `WHAT THIS COURSE ACTUALLY SAYS (ground yourself here; do not invent sources):\n\n${sources}`
      : "This course has nothing indexed on the position yet. Argue from general knowledge and say so in one clause.",
    opts.turns.length > 0
      ? `THE DEBATE SO FAR:\n"""\n${renderTranscript(opts.turns, opts.texts)}\n"""`
      : "You are opening the debate.",
    opts.pending ? pendingInstruction(opts.pending, opts.live) : "",
    opts.live ? "Give your next utterance as the words you say, with no JSON." : "Give your next utterance. Return the required JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const INTERJECTION_GRADE_SYSTEM_PROMPT = `You are marking a student who interrupted an academic debate to make a point. Grade whether their interjection is right about the material and whether it lands on the distinction actually at issue — not whether it is polite or well-written.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "strengths": [string, ...],       // 1-3 concrete things the interjection got right
  "improvements": [string, ...],    // 1-3 concrete corrections; the first is stored as the misconception when they score badly
  "score": number,                  // integer 1-5 (5 = decisive and correct, 1 = confused about the material)
  "modelAnswer": string             // the strongest version of the point they were reaching for
}

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildInterjectionGradePrompt(opts: {
  concept: string;
  grounding: DebateGrounding;
  turns: DebateTurn[];
  texts: Map<number, string>;
  interjection: string;
}): string {
  const sources = renderSources(opts.grounding);

  return [
    `THE POSITION UNDER DEBATE: "${opts.concept}"`,
    sources
      ? `WHAT THIS COURSE SAYS (the ground truth):\n\n${sources}`
      : "No course material was retrieved; judge against your own knowledge.",
    `THE DEBATE SO FAR:\n"""\n${renderTranscript(opts.turns, opts.texts)}\n"""`,
    `THE STUDENT'S INTERJECTION:\n"""\n${opts.interjection}\n"""`,
    "Grade the interjection and return the required JSON.",
  ].join("\n\n");
}
