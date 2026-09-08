import type { ChatMessage } from "@/lib/openrouter";

export const DEFAULT_OLLAMA_MODEL = "qwen3:8b";

export function ollamaModel(): string {
  return process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
}

/** The REASONING tier's ollama model — falls back to the default model. */
export function ollamaReasoningModel(): string {
  return process.env.OLLAMA_MODEL_REASONING || ollamaModel();
}

function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

// For error messages shown in the UI (and persisted in Page.errorMessage):
// never echo the raw env value, which could carry basic-auth credentials.
function ollamaDisplayUrl(): string {
  try {
    return new URL(ollamaBaseUrl()).origin;
  } catch {
    return "the configured OLLAMA_URL";
  }
}

// Local inference on CPU can be slow, but a request should never hang forever
// and pin a route handler with the page stuck mid-pipeline.
const REQUEST_TIMEOUT_MS = 300_000;

// Qwen3 is a "thinking" model; even with think:false requested, some builds
// still emit <think>…</think> preambles. Strip them before parsing/display.
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export async function callOllama(opts: {
  messages: ChatMessage[];
  jsonMode?: boolean;
  /** Overrides ollamaModel() when set — used for the REASONING tier. */
  model?: string;
  /** Raw base64, no `data:` prefix — Ollama's own image field, attached to the
   *  last message. Needs a multimodal model; a text-only one ignores them
   *  silently and answers from the prompt alone. */
  images?: string[];
}): Promise<string> {
  const url = `${ollamaBaseUrl()}/api/chat`;
  const model = opts.model || ollamaModel();
  const images = opts.images ?? [];
  const messages =
    images.length > 0
      ? opts.messages.map((m, i) => (i === opts.messages.length - 1 ? { ...m, images } : m))
      : opts.messages;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        think: false,
        ...(opts.jsonMode ? { format: "json" } : {}),
      }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(
        `Ollama did not respond within ${REQUEST_TIMEOUT_MS / 1000}s. The model may still be loading, or the machine is overloaded — try again.`
      );
    }
    throw new Error(
      `Could not reach Ollama at ${ollamaDisplayUrl()}. Is it running? (ollama serve, then: ollama pull ${model})`
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
