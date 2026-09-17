"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BrainCircuit, FileText, Loader2, Presentation, Send } from "lucide-react";
import clsx from "@/lib/clsx";
import { ChatBubble } from "./ChatBubble";
import { WebSearchToggle } from "@/components/ask/WebSearchToggle";
import { useChatHistory } from "./useChatHistory";

type Citation = { label: string; pageId: string | null; materialId: string | null };
type Message = { role: "user" | "assistant"; content: string; citations?: Citation[] };

const SUGGESTIONS = [
  "What are the main themes across all my lectures?",
  "Summarize everything I've learned about cells",
  "Which lectures mention the French Revolution?",
  "Quiz me on the hardest concept in my notes",
];

/**
 * One thread across every lecture. `compact` is the librarian dock: no page
 * heading, the messages scroll inside the panel and the input stays pinned.
 * Both surfaces read the same stored thread, so a question asked from the
 * dock is still there on the full page.
 */
export function LibraryChat({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages, clearMessages] = useChatHistory<Message>("lectern:chat:library", "local");
  const [input, setInput] = useState("");
  const [web, setWeb] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setError(null);
    const nextMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 30);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-12).map(({ role, content }) => ({ role, content })), web }),
      });
      if (res.ok) {
        const { reply, citations } = await res.json();
        setMessages((m) => [...m, { role: "assistant", content: reply, citations }]);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      } else {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? "The assistant couldn't reply. Try again.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={clsx("flex flex-col", compact ? "h-full gap-3" : "max-w-3xl gap-5")}>
      {!compact && (
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BrainCircuit className="h-6 w-6 text-brand-ink" strokeWidth={2.2} />
            Ask all courses
          </h1>
          <p className="mt-0.5 text-[13px] text-muted">
            One assistant across every lecture you&apos;ve captured. It finds the relevant notes and answers with citations.
          </p>
        </div>
      )}

      <div
        className={clsx(
          "flex flex-col gap-3 rounded-2xl border border-line/80 bg-surface p-4",
          compact ? "min-h-0 flex-1 overflow-y-auto" : "min-h-[24rem]"
        )}
      >
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
              <BrainCircuit className="h-5 w-5" strokeWidth={2} />
            </span>
            <p className="text-[13px] text-muted-2">Ask anything spanning your whole library.</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-brand-border hover:bg-brand-soft/50 hover:text-brand-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={clsx("flex flex-col gap-1.5", m.role === "user" ? "items-end" : "items-start")}>
            <ChatBubble role={m.role} content={m.content} />
            {m.citations && m.citations.length > 0 && (
              <div className="flex max-w-[85%] flex-wrap gap-1.5">
                {m.citations.map((c) =>
                  c.pageId ? (
                    <Link
                      key={c.pageId ?? c.materialId ?? c.label}
                      href={`/pages/${c.pageId}`}
                      className="flex items-center gap-1 rounded-full border border-brand-border bg-brand-soft/40 px-2.5 py-1 text-[11.5px] font-medium text-brand-ink transition-colors hover:bg-brand-soft"
                    >
                      <FileText className="h-3 w-3" strokeWidth={2.2} />
                      {c.label}
                    </Link>
                  ) : (
                    <span
                      key={c.pageId ?? c.materialId ?? c.label}
                      className="flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-ink-soft"
                    >
                      <Presentation className="h-3 w-3" strokeWidth={2.2} />
                      {c.label}
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md bg-surface-3 px-3.5 py-2 text-[13px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> Searching your notes…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {messages.length > 0 && !sending && (
        <button type="button" onClick={clearMessages} className="self-end text-xs text-muted-2 hover:text-ink-soft">
          Clear chat
        </button>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask across all your lectures…"
          className="w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-gold"
        />
        <WebSearchToggle on={web} onChange={setWeb} />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </form>
    </div>
  );
}
