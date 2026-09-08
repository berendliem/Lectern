const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * What the wire format actually allows: content is either a string or a list
 * of parts, which is how an image reaches a vision model. Internal, so
 * ChatMessage — what every text caller passes — stays a plain string.
 */
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ApiMessage = { role: ChatMessage["role"]; content: string | ContentPart[] };

async function callOpenRouter(opts: {
  model: string;
  messages: ApiMessage[];
  jsonMode?: boolean;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your OpenRouter key.");
  }

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch {
    throw new Error("Could not reach OpenRouter. Check your internet connection and try again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.error?.message ?? `OpenRouter returned ${res.status}`;
    throw new Error(`OpenRouter request failed (model: ${opts.model}): ${detail}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenRouter returned an empty response. You can retry this step.");
  }
  return content;
}

export async function callOpenRouterText(opts: {
  model: string;
  messages: ChatMessage[];
}): Promise<string> {
  return (await callOpenRouter(opts)).trim();
}

/**
 * Page images plus an instruction, for a vision-capable model. `images` are
 * `data:` URLs, inlined into the request body — so a scan reaches the model
 * provider and nowhere else, the same trade the rest of the cloud path makes.
 */
export async function callOpenRouterVision(opts: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  images: string[];
}): Promise<string> {
  const content = await callOpenRouter({
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: opts.userPrompt },
          ...opts.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      },
    ],
  });
  return content.trim();
}

export async function callOpenRouterJSON(opts: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<unknown> {
  const content = await callOpenRouter({
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
    jsonMode: true,
  });

  // Some smaller free models wrap JSON in markdown code fences despite
  // response_format: json_object; strip them defensively before parsing.
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(
      "The model returned a response that wasn't valid JSON (this happens sometimes with smaller free models). You can retry this step."
    );
  }
}
