export const ACTION_ITEMS_SYSTEM_PROMPT = `You extract actionable follow-ups from a lecture or meeting transcript, in the style of a meeting notetaker.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "items": [ { "kind": "ACTION" | "DECISION" | "QUESTION", "text": string } ]
}

Definitions:
- "ACTION": assigned work, homework, deadlines, things the listener must do ("read chapter 4 before Friday", "submit problem set 2 by Tuesday"). Include the due date in the text when one was stated.
- "DECISION": decisions or conclusions that were settled ("the midterm will cover chapters 1-5", "we'll use Python for the project").
- "QUESTION": open questions or unresolved issues explicitly left open ("whether the deadline moves will be confirmed next week").

Rules:
- Only include items actually stated in the transcript. Do not invent tasks.
- Many lectures are purely expository and have none — in that case return { "items": [] }.
- Keep each text to one concise sentence.
- At most 15 items, most important first.`;

export function buildActionItemsUserPrompt(transcript: string): string {
  return `Extract the action items, decisions, and open questions from this transcript following the required JSON shape.\n\nTRANSCRIPT:\n"""\n${transcript}\n"""`;
}
