"use client";

import { useEffect, useState } from "react";
import { CircleHelp, Gavel, ListChecks, Loader2, RefreshCw } from "lucide-react";
import clsx from "@/lib/clsx";
import { Button } from "@/components/ui/Button";

type ActionKind = "ACTION" | "DECISION" | "QUESTION";

type ActionItem = {
  id: string;
  kind: ActionKind;
  text: string;
  done: boolean;
};

const GROUPS: { kind: ActionKind; label: string; icon: typeof ListChecks }[] = [
  { kind: "ACTION", label: "Action items", icon: ListChecks },
  { kind: "DECISION", label: "Decisions & deadlines", icon: Gavel },
  { kind: "QUESTION", label: "Open questions", icon: CircleHelp },
];

export function ActionsTab({ pageId, hasTranscript }: { pageId: string; hasTranscript: boolean }) {
  const [items, setItems] = useState<ActionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/pages/${pageId}/action-items`)
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) setItems(data.items ?? []);
      })
      .catch(() => {
        if (!ignore) setItems([]);
      });
    return () => {
      ignore = true;
    };
  }, [pageId]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/action-items`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setItems(body.items ?? []);
      } else {
        setError(body.error ?? "Could not extract action items. Try again.");
      }
    } catch {
      setError("Could not extract action items. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function toggle(item: ActionItem) {
    const next = !item.done;
    setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, done: next } : i)) ?? null);
    const res = await fetch(`/api/action-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: next }),
    });
    if (!res.ok) {
      // The item may have been replaced by a concurrent regenerate — tell the
      // user and re-sync with the server instead of silently undoing the click.
      setError("Couldn't save that change — the list may have been regenerated. Refreshed it.");
      const data = await fetch(`/api/pages/${pageId}/action-items`)
        .then((r) => r.json())
        .catch(() => null);
      if (data?.items) {
        setItems(data.items);
      } else {
        setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)) ?? null);
      }
    }
  }

  if (!hasTranscript) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-400">
        Action items are extracted from the transcript — transcribe this page first.
      </div>
    );
  }

  const hasItems = (items?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Assigned work, decisions, and unresolved questions pulled from the recording — like a
          meeting notetaker&apos;s follow-up notes.
        </p>
        <Button variant="secondary" onClick={generate} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
          )}
          {hasItems ? "Regenerate" : "Extract"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {items === null ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : !hasItems ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-400">
          {loading
            ? "Reading the transcript…"
            : "Nothing extracted yet. Click Extract — purely expository lectures may genuinely have none."}
        </div>
      ) : (
        GROUPS.map(({ kind, label, icon: Icon }) => {
          const group = items.filter((i) => i.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind}>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-zinc-400">
                <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                {label}
              </h3>
              <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
                {group.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => toggle(item)}
                        className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
                      />
                      <span
                        className={clsx(
                          "text-sm",
                          item.done ? "text-zinc-400 line-through" : "text-zinc-700"
                        )}
                      >
                        {item.text}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
