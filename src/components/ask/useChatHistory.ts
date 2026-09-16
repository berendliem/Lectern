"use client";

import { useEffect, useState } from "react";

const MAX_MESSAGES = 40;

/**
 * Chat messages that survive a reload or a tab switch. Session storage, not
 * local: a conversation about a lecture is scratch work for this sitting, and
 * a stale thread reappearing a week later would be noise. Storage can be
 * missing or throw (private windows, blocked site data), so every access is
 * guarded and the chat simply starts empty.
 */
export function useChatHistory<T extends { role: string; content: string }>(
  key: string
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
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setMessages(parsed);
        }
      } catch {
        // Unreadable or unavailable: start empty.
      }
      setLoaded(true);
    });
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (messages.length === 0) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(messages.slice(-MAX_MESSAGES)));
    } catch {
      // Quota or availability: the chat still works, it just will not persist.
    }
  }, [key, messages, loaded]);

  const clear = () => setMessages([]);

  return [messages, setMessages, clear];
}
