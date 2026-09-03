"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BrainCircuit, FileText, Loader2, Presentation, Send } from "lucide-react";
import clsx from "@/lib/clsx";

type Citation = { label: string; pageId: string | null; materialId: string | null };
type Message = { role: "user" | "assistant"; content: string; citations?: Citation[] };

const SUGGESTIONS = [
  "What are the main themes of this course so far?",
  "What does the syllabus say I still haven't covered?",
  "Explain the hardest concept in these lectures simply",
  "Make me a study plan for this course",
];

export function CourseChat({ folderId }: { folderId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
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
      const res = await fetch(`/api/folders/${folderId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(-12).map(({ role, content }) => ({ role, content })),
        }),
      });
      if (res.ok) {
        const { reply, citations, retrieval } = await res.json();
        setDegraded(retrieval === "fts");
        setMessages((m) => [...m, { role: "assistant", content: reply, citations }]);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      } else {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? "The assistant couldn't reply. Try again.");
      }
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-[13px] text-zinc-500">
        Answers come from this course&apos;s lectures and materials, with the source cited.
      </p>

      {degraded && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          Semantic search is unavailable, so this answer used keyword search over this
          course&apos;s lectures only — uploaded materials aren&apos;t searched in this mode. Run{" "}
          <code className="font-mono">npm run reindex</code> to rebuild the index.
        </p>
      )}

      <div className="flex min-h-[22rem] flex-col gap-3 rounded-2xl border border-zinc-200/80 bg-white p-4">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
              <BrainCircuit className="h-5 w-5" strokeWidth={2} />
            </span>
            <p className="text-[13px] text-zinc-400">Ask anything about this course.</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:border-brand-border hover:bg-brand-soft/50 hover:text-brand"
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
            className={clsx("flex flex-col gap-1.5", m.role === "user" ? "items-end" : "items-start")}
          >
            <div
              className={clsx(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13.5px] leading-6",
                m.role === "user"
                  ? "rounded-br-md bg-zinc-900 text-white"
                  : "rounded-bl-md bg-zinc-100 text-zinc-800"
              )}
            >
              {m.content}
            </div>
            {m.citations && m.citations.length > 0 && (
              <div className="flex max-w-[85%] flex-wrap gap-1.5">
                {m.citations.map((c) =>
                  c.pageId ? (
                    <Link
                      key={c.label}
                      href={`/pages/${c.pageId}`}
                      className="flex items-center gap-1 rounded-full border border-brand-border bg-brand-soft/40 px-2.5 py-1 text-[11.5px] font-medium text-brand transition-colors hover:bg-brand-soft"
                    >
                      <FileText className="h-3 w-3" strokeWidth={2.2} />
                      {c.label}
                    </Link>
                  ) : (
                    <span
                      key={c.label}
                      className="flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11.5px] font-medium text-zinc-600"
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
          <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2 text-[13px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> Searching this
            course…
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
          placeholder="Ask about this course…"
          className="w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl grad-brand text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </form>
    </div>
  );
}
