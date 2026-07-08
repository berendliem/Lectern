// Prompts for the concept-map generator: the model distills a lecture into a
// small graph of key concepts and labeled relationships, rendered as an
// interactive mind-map on the page.

export const CONCEPT_MAP_SYSTEM_PROMPT = `You are an expert at distilling lecture material into concept maps that show how ideas relate.

Extract the 8-16 most important concepts and the meaningful relationships between them. Node labels must be short (at most 4 words). Assign each node a "group" integer 0-4 clustering closely related concepts together (group 0 = the most central theme). Edge labels are 1-3 words naming the relationship (e.g. "causes", "part of", "enables", "contrasts with"). Every edge's "from" and "to" must exactly match a node "id". Prefer a connected graph over isolated nodes.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "nodes": [{ "id": string, "label": string, "group": number }],
  "edges": [{ "from": string, "to": string, "label": string }]
}`;

export function buildConceptMapUserPrompt(title: string, material: string): string {
  return `Lecture title: "${title}"\n\nLECTURE MATERIAL:\n"""\n${material.slice(0, 8000)}\n"""\n\nBuild the concept map for this lecture and return the required JSON.`;
}
