// Reading an MCP tool result. Kept free of the client so it can be tested
// without spawning a server.

export type ToolResultLike = { content?: unknown; structuredContent?: unknown };

/** The result's text blocks, joined. Other block types are ignored. */
export function toolResultText(result: ToolResultLike): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .filter((b): b is { type: "text"; text: string } => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/**
 * The result as JSON. Prefers structuredContent: a FastMCP tool that returns a
 * list sends one text block per element — which joined is not JSON — and the
 * faithful copy only in `structuredContent.result`. A tool returning a plain
 * dict sends no structured content at all, just one JSON text block.
 */
export function toolResultJson(result: ToolResultLike): unknown {
  const structured = result.structuredContent;
  if (structured && typeof structured === "object") {
    const keys = Object.keys(structured);
    if (keys.length === 1 && keys[0] === "result") return (structured as { result: unknown }).result;
    return structured;
  }

  const text = toolResultText(result);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The MCP tool's reply was not JSON: ${text.slice(0, 200)}`);
  }
}
