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

/**
 * The default every stage falls back to. It is a router, not a model: OpenRouter
 * picks whatever free model it likes, and that pool includes models that are not
 * chat models at all — nvidia/nemotron-3.5-content-safety:free answers any prompt
 * with "User Safety: safe", which then lands in the chat bubble as the answer.
 */
const FREE_ROUTER = "openrouter/free";

/**
 * Sent as OpenRouter's `models` fallback chain in place of the router: it tries
 * these in order and falls through on an unavailable or retired model, which is
 * the property the router was there for, without the non-chat models. All three
 * are free-tier, and all three take response_format, so the JSON stages keep
 * working wherever the chain lands.
 */
const FREE_CHAT_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nex-agi/nex-n2.5-pro:free",
  "dots-studio/dots-3-note-preview:free",
];

/** Exported for the test; `model` and `models` are mutually exclusive upstream. */
export function modelField(model: string): { model: string } | { models: string[] } {
  return model === FREE_ROUTER ? { models: FREE_CHAT_MODELS } : { model };
}

/**
 * OpenRouter's web plugin: the request gets a web search whose results are
 * prepended to the prompt before the model sees it. Off unless the student
 * switched it on, since every search is billed on top of the completion.
 */
export function webPluginField(web?: boolean): { plugins: { id: "web" }[] } | Record<string, never> {
  return web ? { plugins: [{ id: "web" }] } : {};
}

async function callOpenRouter(opts: {
  model: string;
  messages: ApiMessage[];
  jsonMode?: boolean;
  web?: boolean;
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
        ...modelField(opts.model),
        ...webPluginField(opts.web),
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
  web?: boolean;
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
  web?: boolean;
}): Promise<unknown> {
  const content = await callOpenRouter({
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
    jsonMode: true,
    web: opts.web,
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
