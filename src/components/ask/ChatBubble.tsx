import { Markdown } from "@/components/Markdown";
import clsx from "@/lib/clsx";

// Models reach for <br> inside markdown tables. react-markdown escapes raw HTML,
// so those tags would otherwise render as literal text in the bubble; a space is
// the safe substitution — a newline would end the table row it sits in.
const stripHtmlBreaks = (text: string) => text.replace(/<br\s*\/?>/gi, " ");

/**
 * One chat bubble. Assistant replies arrive as markdown — headings, bold, lists,
 * tables — so they render through react-markdown; the student's own text renders
 * verbatim, since a question typed with an asterisk means an asterisk.
 */
export function ChatBubble({
  role,
  content,
  className,
}: {
  role: "user" | "assistant";
  content: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-6",
        role === "user"
          ? "whitespace-pre-wrap rounded-br-md bg-ink text-surface"
          : "prose prose-sm prose-zinc overflow-x-auto rounded-bl-md bg-surface-3 text-ink prose-headings:my-2 prose-headings:text-[13.5px] prose-headings:font-semibold prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 dark:prose-invert",
        className
      )}
    >
      {role === "user" ? (
        content
      ) : (
        <Markdown>{stripHtmlBreaks(content)}</Markdown>
      )}
    </div>
  );
}
