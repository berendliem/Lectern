import { callOpenRouterText, callOpenRouterJSON, type ChatMessage } from "@/lib/openrouter";
import { callOllama, ollamaModel } from "@/lib/ollama";

export type { ChatMessage };

/**
 * Pipeline stage hint. Today only "summary" has a per-stage provider override
 * (LLM_PROVIDER_SUMMARY), so you can run summaries locally on Qwen3 via Ollama
 * while everything else stays on OpenRouter — or vice versa.
 */
export type LLMStage = "summary";

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
    return callOllama({ messages: opts.messages });
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
