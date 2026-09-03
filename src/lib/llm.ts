import { callOpenRouterText, callOpenRouterJSON, type ChatMessage } from "@/lib/openrouter";
import { callOllama, ollamaModel, ollamaReasoningModel } from "@/lib/ollama";

export type { ChatMessage };

/**
 * Pipeline stage hint. "summary" has a per-stage provider override
 * (LLM_PROVIDER_SUMMARY), so you can run summaries locally on Qwen3 via Ollama
 * while everything else stays on OpenRouter — or vice versa. "reasoning"
 * selects OLLAMA_MODEL_REASONING on the ollama path (see reasoningModel()
 * below for the OpenRouter half of that tier).
 */
export type LLMStage = "summary" | "reasoning";

type Provider = "openrouter" | "ollama";

function resolveProvider(stage?: LLMStage): Provider {
  const override = stage === "summary" ? process.env.LLM_PROVIDER_SUMMARY : undefined;
  const raw = (override || process.env.LLM_PROVIDER || "openrouter").trim().toLowerCase();
  if (raw === "ollama") return "ollama";
  if (raw !== "openrouter") {
    throw new Error(`Unknown LLM provider "${raw}". Use "openrouter" or "ollama".`);
  }
  return "openrouter";
}

/** Label recorded in the DB's modelUsed columns, e.g. "ollama:qwen3:8b". */
export function llmModelLabel(openrouterModel: string, stage?: LLMStage): string {
  return resolveProvider(stage) === "ollama" ? `ollama:${ollamaModel()}` : openrouterModel;
}

export async function callLLMText(opts: {
  model: string;
  messages: ChatMessage[];
  stage?: LLMStage;
}): Promise<string> {
  if (resolveProvider(opts.stage) === "ollama") {
    return callOllama({
      messages: opts.messages,
      model: opts.stage === "reasoning" ? ollamaReasoningModel() : undefined,
    });
  }
  return callOpenRouterText({ model: opts.model, messages: opts.messages });
}

export async function callLLMJSON(opts: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  stage?: LLMStage;
}): Promise<unknown> {
  if (resolveProvider(opts.stage) === "ollama") {
    const content = await callOllama({
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
      jsonMode: true,
      model: opts.stage === "reasoning" ? ollamaReasoningModel() : undefined,
    });
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error(
        "The local model returned a response that wasn't valid JSON. You can retry this step."
      );
    }
  }
  return callOpenRouterJSON({
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
  });
}

/**
 * The REASONING tier: course-scoped work that stuffs several retrieved chunks
 * into one prompt, which is the one place context length and reasoning quality
 * matter. Provider dispatch is the existing LLM_PROVIDER branch in
 * callLLMText, so this only names the OpenRouter model; callers pass
 * `stage: "reasoning"` to callLLMText so the ollama path picks up
 * OLLAMA_MODEL_REASONING (see ollamaReasoningModel()) instead of the
 * general-purpose OLLAMA_MODEL.
 */
export function reasoningModel(): string {
  return (
    process.env.OPENROUTER_MODEL_REASONING ??
    process.env.OPENROUTER_MODEL_CHAT ??
    process.env.OPENROUTER_MODEL_SUMMARY ??
    "openrouter/free"
  );
}
