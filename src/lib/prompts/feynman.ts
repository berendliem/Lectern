// Prompts for the Feynman-technique coach: the student explains a concept in
// plain language as if teaching a beginner, and the model grades the clarity
// and completeness of that explanation, surfacing gaps and hidden jargon.

import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

export const FEYNMAN_SYSTEM_PROMPT = `You are a Feynman-technique study coach. The student is trying to master a concept by explaining it, in the simplest possible terms, as if teaching a curious 12-year-old. Your job is to judge how well their explanation would actually make a beginner understand the idea — not how sophisticated it sounds.

Evaluate the explanation for: correctness, completeness (did they miss anything essential?), simplicity (did they lean on jargon or hand-wave?), and use of intuition/analogy. Be encouraging but honest and specific — reference what they actually said.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "score": number,           // integer 0-100: how well a beginner would understand from this explanation alone
  "verdict": string,         // one warm, honest sentence summarizing the explanation
  "strengths": [string],     // 1-3 concrete things explained clearly (empty array if none)
  "gaps": [string],          // 1-4 missing, vague, or incorrect points to fix (empty array if none)
  "jargon": [string],        // 0-4 technical terms they used without explaining — that a beginner wouldn't get
  "followUp": string         // one probing question that targets the biggest gap, to push their understanding deeper
}

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildFeynmanUserPrompt(opts: {
  concept: string;
  reference?: string;
  explanation: string;
  priorExplanations: string[];
}): string {
  const parts: string[] = [`CONCEPT THE STUDENT IS EXPLAINING: "${opts.concept}"`];

  if (opts.reference && opts.reference.trim()) {
    parts.push(`REFERENCE MATERIAL (the ground truth — judge correctness and completeness against this):\n"""\n${opts.reference.slice(0, 8000)}\n"""`);
  } else {
    parts.push("No reference material was provided; judge against your own knowledge of the concept.");
  }

  if (opts.priorExplanations.length > 0) {
    const prior = opts.priorExplanations.map((e, i) => `Attempt ${i + 1}:\n${e}`).join("\n\n");
    parts.push(`THE STUDENT'S EARLIER ATTEMPTS (for context — they are refining):\n"""\n${prior}\n"""`);
  }

  parts.push(`THE STUDENT'S CURRENT EXPLANATION:\n"""\n${opts.explanation}\n"""`);
  parts.push("Evaluate this explanation and return the required JSON.");

  return parts.join("\n\n");
}
