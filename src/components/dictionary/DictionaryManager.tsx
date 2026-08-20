"use client";

import { useEffect, useState } from "react";
import { BookOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type DictionaryTerm = {
  id: string;
  term: string;
  hint: string | null;
  createdAt: string;
};

export function DictionaryManager() {
  const [terms, setTerms] = useState<DictionaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState("");
  const [hint, setHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/dictionary")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) {
          setTerms(data.terms ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term: term.trim(), hint: hint.trim() || undefined }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      setTerms((prev) => [data.term, ...prev]);
      setTerm("");
      setHint("");
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not add the term. Try again.");
    }
  }

  async function handleDelete(id: string) {
    setTerms((prev) => prev.filter((t) => t.id !== id));
    const res = await fetch(`/api/dictionary/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // Restore on failure so the list stays truthful.
      const data = await fetch("/api/dictionary").then((r) => r.json()).catch(() => null);
      if (data) setTerms(data.terms ?? []);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-zinc-900">
          <BookOpen className="h-5 w-5 text-brand" strokeWidth={2.2} />
          Personal dictionary
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-500">
          Names, acronyms, and jargon you add here are passed to the local whisper model as
          vocabulary hints, so they&apos;re transcribed with the right spelling — and the
          summarizer keeps them spelled correctly in your notes.
        </p>
      </div>

      <form onSubmit={handleAdd} className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Term (e.g. EBITDA, Dr. Okonkwo, PyTorch)"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          maxLength={64}
          className="sm:max-w-xs"
        />
        <Input
          placeholder="Optional hint (what it means)"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          maxLength={200}
          className="sm:flex-1"
        />
        <Button type="submit" disabled={submitting || !term.trim()}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : terms.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-400">
          No terms yet. Add the names and jargon whisper keeps getting wrong.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
          {terms.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-sm font-medium text-zinc-800">{t.term}</span>
              {t.hint && <span className="truncate text-[13px] text-zinc-400">{t.hint}</span>}
              <button
                onClick={() => handleDelete(t.id)}
                className="ml-auto rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                aria-label={`Remove ${t.term}`}
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
