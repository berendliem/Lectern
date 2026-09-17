"use client";

import { useEffect, useState } from "react";

const MAX_MESSAGES = 40;
// Well under the per-origin quota even with a chat open per lecture; past it
// the oldest messages go first, the way the count cap works.
const MAX_BYTES = 200_000;

/**
 * Storage is written by this app but it is still outside it: a devtools edit
 * or a reply that once arrived without `content` would otherwise hydrate a
 * bubble that throws on every mount, with no error boundary to catch it.
 */
function isMessage(m: unknown): m is { role: string; content: string; citations?: unknown[] } {
  if (typeof m !== "object" || m === null) return false;
  const { role, content, citations } = m as Record<string, unknown>;
  if ((role !== "user" && role !== "assistant") || typeof content !== "string") return false;
  return citations === undefined || Array.isArray(citations);
}

function trimToBudget<T>(messages: T[]): string {
  let kept = messages.slice(-MAX_MESSAGES);
  let json = JSON.stringify(kept);
  while (json.length > MAX_BYTES && kept.length > 1) {
    kept = kept.slice(1);
    json = JSON.stringify(kept);
  }
  return json;
}

/**
 * Chat messages that survive a reload or a tab switch. Session storage by
 * default: a conversation about a lecture is scratch work for this sitting, and
 * a stale thread reappearing a week later would be noise. The library-wide
 * thread opts into local storage instead, because the librarian is meant to be
 * picked up where it was left. Storage can be missing or throw (private
 * windows, blocked site data), so every access is guarded and the chat simply
 * starts empty.
 */
export function useChatHistory<T extends { role: string; content: string }>(
  key: string,
  storage: "session" | "local" = "session"
): [T[], (update: T[] | ((prev: T[]) => T[])) => void, () => void] {
  const [messages, setMessages] = useState<T[]>([]);
  // Read after mount, never during render: the server renders an empty chat
  // and the first client render has to match it. Deferred to a microtask, the
  // way the focus timer loads its settings, so it is neither a hydration
  // mismatch nor a synchronous setState inside the effect.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const store = storage === "local" ? localStorage : sessionStorage;
        const raw = store.getItem(key);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.every(isMessage)) setMessages(parsed as T[]);
          else store.removeItem(key);
        }
      } catch {
        // Unreadable or unavailable: start empty.
      }
      setLoaded(true);
    });
  }, [key, storage]);

  // Local storage is shared between tabs, and each tab holds its own copy of
  // the thread: without this, a tab that sent nothing would write its stale
  // copy back over a message another tab just added.
  useEffect(() => {
    if (storage !== "local") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.storageArea !== localStorage) return;
      try {
        const parsed: unknown = e.newValue ? JSON.parse(e.newValue) : [];
        if (Array.isArray(parsed) && parsed.every(isMessage)) setMessages(parsed as T[]);
      } catch {
        // Another tab wrote something unreadable: keep what this tab has.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, storage]);

  useEffect(() => {
    if (!loaded) return;
    try {
      const store = storage === "local" ? localStorage : sessionStorage;
      if (messages.length === 0) store.removeItem(key);
      else store.setItem(key, trimToBudget(messages));
    } catch {
      // Quota or availability: the chat still works, it just will not persist.
    }
  }, [key, storage, messages, loaded]);

  const clear = () => setMessages([]);

  return [messages, setMessages, clear];
}
