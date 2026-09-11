/**
 * Cross-encoder reranking.
 *
 * Cosine similarity compares a question vector and a chunk vector that were
 * computed independently, which is why a bi-encoder retrieves well and orders
 * badly. A cross-encoder reads the pair together and scores relevance directly.
 * It is far too slow to run over a corpus and exactly right over a few dozen
 * candidates.
 */

const MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";

// The pipeline() "text-classification" task drops `text_pair` on the floor —
// TextClassificationPipeline._call only forwards `texts` and `top_k` to the
// tokenizer, so scoring a { text, text_pair } object through it returns the
// same score (1.0) for every candidate instead of throwing. Talking to the
// tokenizer and model directly is the only way this model's pair-aware score
// comes through.
type Tokenizer = (
  text: string | string[],
  options: { text_pair: string | string[]; padding: true; truncation: true }
) => Promise<unknown>;
type ClassifierModel = (inputs: unknown) => Promise<{ logits: { tolist: () => number[][] } }>;

// The tokenizer and model hold a loaded model in memory; build them once per process.
let scorerPromise: Promise<{ tokenizer: Tokenizer; model: ClassifierModel }> | null = null;
let warned = false;

async function getScorer(): Promise<{ tokenizer: Tokenizer; model: ClassifierModel }> {
  const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@huggingface/transformers");
  if (!scorerPromise) {
    // q8 keeps the download near 23MB, the same trade the embedder makes.
    scorerPromise = Promise.all([
      AutoTokenizer.from_pretrained(MODEL),
      AutoModelForSequenceClassification.from_pretrained(MODEL, { dtype: "q8" }),
    ]).then(
      ([tokenizer, model]) => ({
        tokenizer: tokenizer as unknown as Tokenizer,
        model: model as unknown as ClassifierModel,
      }),
      (e) => {
        // Don't memoize a rejection: a one-off network hiccup during the first
        // download would otherwise disable reranking for the life of the
        // process, since the cached rejected promise is reused forever.
        scorerPromise = null;
        throw e;
      }
    );
  }
  return scorerPromise;
}

async function scoreOne(
  tokenizer: Tokenizer,
  model: ClassifierModel,
  query: string,
  text: string
): Promise<number> {
  const inputs = await tokenizer(query, { text_pair: text, padding: true, truncation: true });
  const { logits } = await model(inputs);
  return logits.tolist()[0][0];
}

/**
 * Reorders candidates by cross-encoder relevance to the query.
 *
 * Never throws. Reranking is a quality improvement, so when the model cannot
 * load — offline on first run, most likely — the candidates come back in the
 * order they arrived (cosine order) and the question is still answered. The
 * warning is logged once per process rather than once per query.
 */
export async function rerank<T extends { text: string }>(
  query: string,
  candidates: T[]
): Promise<T[]> {
  if (candidates.length <= 1) return candidates;
  try {
    const { tokenizer, model } = await getScorer();

    let scores: number[];
    try {
      // One tokenizer call and one model call for every candidate, instead of
      // one round trip per candidate.
      const inputs = await tokenizer(
        candidates.map(() => query),
        { text_pair: candidates.map((c) => c.text), padding: true, truncation: true }
      );
      const { logits } = await model(inputs);
      const rows = logits.tolist();
      if (rows.length !== candidates.length) throw new Error("batched scorer output length mismatch");
      scores = rows.map((row) => row[0]);
    } catch {
      // Score one pair at a time if the batched call throws or its output
      // doesn't line up 1:1 with the candidates.
      scores = [];
      for (const candidate of candidates) {
        scores.push(await scoreOne(tokenizer, model, query, candidate.text));
      }
    }

    return candidates
      .map((candidate, i) => ({ candidate, score: scores[i] }))
      .sort((a, b) => b.score - a.score)
      .map((scored) => scored.candidate);
  } catch (e) {
    if (!warned) {
      warned = true;
      console.error("[rerank] unavailable, falling back to cosine order:", e);
    }
    return candidates;
  }
}
