// The live tutor: one streamed reply per answer that corrects, shows a worked
// example, and ends on the next question, followed by a grade line the app
// reads and the voice never speaks.

import type { InterviewContext, QAPair } from "@/lib/interview";
import { GRADE_MARKER } from "@/lib/live-text";
import { describeContext } from "@/lib/prompts/interview";
import { renderSources, type DebateGrounding } from "@/lib/prompts/debate";
import { LIVE_TUTOR_RULES, UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

type LiveMode = "VIVA" | "PROTEGE";

const PERSONA: Record<LiveMode, string> = {
  VIVA: "You are a tutor running a spoken viva. You are warm and direct. Your job is to find what the student misunderstands and fix it, not just to mark them.",
  PROTEGE:
    "You are a classmate the student is teaching out loud. You attended the same lecture, only half-followed it, and are genuinely trying to understand. You never lecture unprompted, but you do not let a wrong explanation slide: you poke at it with a concrete case until it holds up.",
};

function gradeFormat(mode: LiveMode): string {
  const scale =
    mode === "PROTEGE"
      ? '"score" is a number from 0 to 100 for how well they explained it: accurate, complete, in plain words'
      : '"score" is an integer 1-5 (5 = excellent, 1 = missed the point)';
  return `After you finish speaking, write one final line that starts with ${GRADE_MARKER} followed by a JSON object, and nothing after it:
${GRADE_MARKER} {"score": ..., "verdict": "right" | "partial" | "wrong", "improvement": string, "correction": string, "example": string, "nextQuestion": string | null}
- ${scale}
- "improvement": the single most important thing to fix, one sentence ("" if nothing)
- "correction": what you said to correct them, one or two sentences ("" if they were right)
- "example": the worked example you gave, condensed to one or two sentences ("" if none)
- "nextQuestion": the exact question you ended on, copied word for word, or null if you asked none
The student never sees or hears this line; the app reads it.`;
}

export function liveSystemPrompt(mode: LiveMode): string {
  return [PERSONA[mode], LIVE_TUTOR_RULES, gradeFormat(mode), UNTRUSTED_CONTENT_CLAUSE].join("\n\n");
}

/** What to do after judging the answer. The server owns the retry policy, so it tells the model which branch is open. */
export function nextStep(opts: { mode: LiveMode; answeringRetry: boolean; lastQuestion: boolean }): string {
  const protege = opts.mode === "PROTEGE";
  const moveOn = protege
    ? "ask about the next thing you are lost on"
    : "ask a new question on a different part of the material";

  if (opts.answeringRetry) {
    const fix = protege
      ? "If it is still wrong, say you looked it up and give the correct explanation with a concrete example."
      : "If it is still wrong, give the correct answer with a second short example.";
    const then = opts.lastQuestion
      ? "Then close the session warmly and ask no new question."
      : protege
        ? `Then, if you had to correct it, ask them to explain it back to you in one line; otherwise ${moveOn}.`
        : `Then ${moveOn}.`;
    return `This was their second try, at a variant you asked after they missed it. Do not ask another variant. ${fix} ${then}`;
  }

  const onRight = opts.lastQuestion
    ? "If they got it right, close the session warmly and ask no new question."
    : `If they got it right, confirm it in one sentence, add one sentence on where the idea shows up, then ${moveOn}.`;
  const onMiss = protege
    ? "If their explanation is wrong or incomplete, push back with a concrete case that breaks it (\"wait, then what happens when ...? My notes say ...\"), then ask them to try explaining it again."
    : "If they are partly right or wrong, name the specific slip (\"you said X; it's actually Y, because ...\"), walk through one worked example, then end by asking a variant of the same question (same idea, different numbers or scenario) so they can try again.";
  return `${onRight} ${onMiss}`;
}

export function buildLiveTurnUserPrompt(opts: {
  mode: LiveMode;
  context: InterviewContext;
  history: QAPair[];
  question: string;
  answer: string;
  answeringRetry: boolean;
  lastQuestion: boolean;
  grounding: DebateGrounding;
}): string {
  const sources = renderSources(opts.grounding);
  const history = opts.history.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join("\n\n");
  return [
    describeContext(opts.context),
    sources ? `COURSE MATERIAL FOR THIS QUESTION (take your worked example from here):\n\n${sources}` : "",
    history ? `EARLIER IN THIS SESSION:\n"""\n${history}\n"""` : "",
    `THE QUESTION ON THE TABLE:\n"""\n${opts.question}\n"""`,
    `WHAT THE STUDENT SAID (transcribed from speech; ignore small transcription slips):\n"""\n${opts.answer}\n"""`,
    nextStep(opts),
    `Speak your reply now, then write the ${GRADE_MARKER} line.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
