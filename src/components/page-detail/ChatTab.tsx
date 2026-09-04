"use client";

import { useRef, useState } from "react";
import { Loader2, MessageCircleQuestion, Send } from "lucide-react";
import clsx from "@/lib/clsx";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Summarize the key points in 3 sentences",
  "What's most likely to come up on an exam?",
  "Explain the hardest concept simply",
];

export function ChatTab({ pageId, hasMaterial }: { pageId: string; hasMaterial: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
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
    endRef.current?.scrollIntoView({ behavior: "smooth" });

    const res = await fetch(`/api/pages/${pageId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: nextMessages.slice(-12) }),
    });
    setSending(false);

    if (res.ok) {
      const { reply } = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "The assistant couldn't reply. Try again.");
    }
  }

  if (!hasMaterial) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <MessageCircleQuestion className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink-soft">Nothing to chat about yet</p>
          <p className="mt-1 text-[13px] text-muted-2">Transcribe the lecture first — then ask the assistant anything about it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[26rem] min-h-40 flex-col gap-3 overflow-y-auto rounded-xl border border-line/80 bg-surface p-4">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
            <p className="text-[13px] text-muted-2">Ask anything about this lecture.</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-brand-border hover:bg-brand-soft/50 hover:text-brand"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={clsx(
              "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13.5px] leading-6",
              m.role === "user"
                ? "self-end rounded-br-md bg-ink text-surface"
                : "self-start rounded-bl-md bg-surface-3 text-ink"
            )}
          >
            {m.content}
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md bg-surface-3 px-3.5 py-2 text-[13px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
            Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

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
          placeholder="Ask about this lecture…"
          className="w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink text-surface transition-colors hover:bg-ink-soft disabled:bg-line-strong"
          aria-label="Send"
        >
          <Send className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </form>
    </div>
  );
}
