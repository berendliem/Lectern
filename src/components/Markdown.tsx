import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { protectCurrency } from "@/lib/inline-math";

/**
 * The one place markdown rendering is configured. Every surface that shows
 * model-written markdown — notes, chat replies, the study plan — renders
 * through here, so a plugin added once shows up everywhere rather than in
 * whichever component someone remembered to update.
 *
 * Single-dollar inline math stays on, because `$x^2$` is what the models emit.
 * That collides with prices in prose, so `protectCurrency` escapes the dollars
 * that open an amount before remark-math can read a sentence as a formula.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
      {protectCurrency(children)}
    </ReactMarkdown>
  );
}
