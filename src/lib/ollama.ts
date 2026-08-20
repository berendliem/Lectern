import type { ChatMessage } from "@/lib/openrouter";

export const DEFAULT_OLLAMA_MODEL = "qwen3:8b";

export function ollamaModel(): string {
  return process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
}

function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

// Qwen3 is a "thinking" model; even with think:false requested, some builds
// still emit <think>…</think> preambles. Strip them before parsing/display.
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export async function callOllama(opts: {
  messages: ChatMessage[];
  jsonMode?: boolean;
}): Promise<string> {
  const url = `${ollamaBaseUrl()}/api/chat`;
  const model = ollamaModel();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        stream: false,
        think: false,
        ...(opts.jsonMode ? { format: "json" } : {}),
      }),
    });
  } catch {
    throw new Error(
      `Could not reach Ollama at ${ollamaBaseUrl()}. Is it running? (ollama serve, then: ollama pull ${model})`
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail =
      typeof body?.error === "string" ? body.error : `Ollama returned ${res.status}`;
    if (/not found/i.test(detail)) {
      throw new Error(`Ollama does not have the model "${model}" yet. Run: ollama pull ${model}`);
    }
    throw new Error(`Ollama request failed (model: ${model}): ${detail}`);
  }

  const data = await res.json();
  const content = data?.message?.content;
  if (typeof content !== "string" || !stripThinking(content)) {
    throw new Error("Ollama returned an empty response. You can retry this step.");
  }
  return stripThinking(content);
}
