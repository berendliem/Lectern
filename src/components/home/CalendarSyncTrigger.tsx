"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const SKIP_KEY = "lectern:calendar-unconfigured";

// Dev strict mode double-invokes the effect; `cancelled` only stops acting
// on the response, not the second fetch. This guard makes the fetch itself
// singular across both invocations.
let inFlight: Promise<void> | null = null;

/**
 * Fires one sync when the server said the newest row is stale, then refreshes
 * the page so the server component re-reads. A 409 (not configured) is
 * remembered for the tab's session so home stops asking.
 */
export function CalendarSyncTrigger({ stale }: { stale: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!stale) return;
    try {
      if (sessionStorage.getItem(SKIP_KEY) === "1") return;
    } catch {
      // Storage may be unavailable; a sync attempt is harmless.
    }
    if (inFlight) return;
    let cancelled = false;
    inFlight = fetch("/api/integrations/calendar/sync", { method: "POST" })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 409) {
          try {
            sessionStorage.setItem(SKIP_KEY, "1");
          } catch {
            // ignore
          }
          return;
        }
        if (res.ok) router.refresh();
        else console.warn("[calendar] background sync failed", res.status);
      })
      .catch((e) => console.warn("[calendar] background sync failed", e))
      .finally(() => {
        inFlight = null;
      });
    return () => {
      cancelled = true;
    };
  }, [stale, router]);

  return null;
}
