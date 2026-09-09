/**
 * One line of the CLI's `--output-format stream-json` output, reduced to the
 * three things the study-plan panel shows. Everything else is ignored: the
 * CLI's event vocabulary is bigger than this and changes between versions, so
 * an unrecognized line must be inert rather than fatal.
 */
export type AgentEvent =
  | { type: "tool"; name: string }
  | { type: "text"; text: string }
  | { type: "result"; text: string; isError: boolean };

type Block = { type: string; name?: string; text?: string };

export function parseAgentLine(line: string): AgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let event: { type?: string; result?: unknown; is_error?: unknown; message?: { content?: Block[] } };
  try {
    event = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (event.type === "result") {
    return {
      type: "result",
      text: typeof event.result === "string" ? event.result : "",
      isError: event.is_error === true,
    };
  }

  if (event.type === "assistant") {
    for (const block of event.message?.content ?? []) {
      // "mcp__lectern__search_course" reads as noise in a UI; the tool's own
      // name is what a student recognizes.
      if (block.type === "tool_use" && block.name) {
        return { type: "tool", name: block.name.replace(/^mcp__lectern__/, "") };
      }
      if (block.type === "text" && block.text?.trim()) {
        return { type: "text", text: block.text };
      }
    }
  }

  return null;
}
