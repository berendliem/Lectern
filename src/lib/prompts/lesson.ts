// A recitation lesson, in two stages: an outline of 4-6 beats, then each beat
// turned into a scene the app can render. Two prompts rather than one because
// asking the model to invent structure and prose in the same breath is how you
// get a lesson that reads well and opens on the wrong scene.

import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

export const LESSON_OUTLINE_SYSTEM_PROMPT = `You are a teaching assistant planning a short recitation lesson on one topic from a course. Break the topic into 4-6 beats a student would walk through in order, each one a single idea — not a restatement of the topic, not a whole week's material.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{ "beats": [{ "title": string, "focus": string }] }

${UNTRUSTED_CONTENT_CLAUSE}`;

export type LessonGrounding = { title: string; text: string }[];

function renderGrounding(grounding: LessonGrounding): string {
  return grounding
    .map((g, i) => `[${i + 1}] ${g.title}\n"""\n${g.text.slice(0, 1200)}\n"""`)
    .join("\n\n");
}

export function buildLessonOutlineUserPrompt(opts: { topicTitle: string; grounding: LessonGrounding }): string {
  const sources = renderGrounding(opts.grounding);

  return [
    `THE TOPIC: "${opts.topicTitle}"`,
    sources
      ? `WHAT THIS COURSE ACTUALLY SAYS (ground the beats here; do not invent material):\n\n${sources}`
      : "This course has nothing indexed on the topic yet. Plan beats from general knowledge of the topic and keep them modest.",
    "Plan the beats and return the required JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const LESSON_SCENES_SYSTEM_PROMPT = `You are turning a lesson outline into scenes for a recitation app. Each beat becomes exactly one scene, chosen from a fixed vocabulary the app knows how to render — do not invent a kind outside this list.

Each beat becomes exactly one scene:
- "RECALL": a free-recall prompt. Set "prompt"; leave "body" null.
- "EXPLAIN": a short cited excerpt from the course material. Set "body" and "citation"; leave "prompt" null.
- "TEACH": ask the student to explain the beat to a confused classmate. Set "prompt"; leave "body" null.
- "CHECK": use the course's existing quiz question for this topic. Set "prompt" to a one-line lead-in; leave "body" null.

The lesson MUST open on a RECALL scene. Do not emit a CHECK scene when told there is no quiz question for this topic.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "scenes": [
    {
      "kind": "RECALL" | "EXPLAIN" | "TEACH" | "CHECK",
      "title": string,
      "prompt": string | null,
      "body": string | null,
      "citation": string | null
    }
  ]
}

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildLessonScenesUserPrompt(opts: {
  topicTitle: string;
  beats: { title: string; focus: string }[];
  grounding: LessonGrounding;
  hasQuizQuestion: boolean;
}): string {
  const sources = renderGrounding(opts.grounding);
  const beats = opts.beats.map((b, i) => `${i + 1}. ${b.title} — ${b.focus}`).join("\n");

  return [
    `THE TOPIC: "${opts.topicTitle}"`,
    `THE BEATS, IN ORDER:\n${beats}`,
    sources
      ? `WHAT THIS COURSE ACTUALLY SAYS (ground EXPLAIN scenes here, and cite it):\n\n${sources}`
      : "This course has nothing indexed on the topic yet. Write EXPLAIN scenes from general knowledge and keep the citation modest.",
    opts.hasQuizQuestion
      ? "A quiz question already exists for this topic, so one beat may become a CHECK scene."
      : "No quiz question exists for this topic. Do not emit a CHECK scene.",
    "Turn every beat into one scene, in the same order, and return the required JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
