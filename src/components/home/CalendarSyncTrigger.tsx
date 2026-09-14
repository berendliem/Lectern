"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { STALE_AFTER_MS } from "@/lib/calendar-events";

const SKIP_KEY = "lectern:calendar-unconfigured";
const SYNCED_AT_KEY = "lectern:calendar-synced-at";
const FAILED_AT_KEY = "lectern:calendar-sync-failed-at";

// Dev strict mode double-invokes the effect; this guard makes the fetch
// itself singular across both invocations. Assumes a single
// CalendarSyncTrigger instance per page (true today: home renders one).
// Navigating away and back during a slow sync means the completed sync does
// not refresh the second mount; the next navigation shows the rows.
let inFlight: Promise<void> | null = null;

/**
 * Fires one sync when the server said the newest row is stale, then refreshes
 * the page so the server component re-reads. Three sessionStorage keys keep
 * a tab from hammering the endpoint: a 409 (not configured) is remembered so
 * home stops asking; a recent success or failure timestamp is remembered too,
 * because a calendar with zero events has no rows and therefore no syncedAt
 * in the DB — the server always reports stale for it, so the tab has to
 * remember on its own that it already tried recently. `mounted` gates the
 * refresh so a component that has already unmounted (route change mid-fetch)
 * does not call router.refresh() on a dead page.
 */
export function CalendarSyncTrigger({ stale }: { stale: boolean }) {
  const router = useRouter();
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    const alreadyTriedRecently = () => {
      try {
        if (sessionStorage.getItem(SKIP_KEY) === "1") return true;
      } catch {
        // Storage may be unavailable; a sync attempt is harmless.
      }
      try {
        const syncedAt = sessionStorage.getItem(SYNCED_AT_KEY);
        const failedAt = sessionStorage.getItem(FAILED_AT_KEY);
        const recent = (iso: string | null) => iso !== null && Date.now() - new Date(iso).getTime() < STALE_AFTER_MS;
        return recent(syncedAt) || recent(failedAt);
      } catch {
        // Storage may be unavailable; a sync attempt is harmless.
        return false;
      }
    };

    if (stale && !inFlight && !alreadyTriedRecently()) {
      inFlight = fetch("/api/integrations/calendar/sync", { method: "POST" })
        .then((res) => {
          if (res.status === 409) {
            try {
              sessionStorage.setItem(SKIP_KEY, "1");
            } catch {
              // ignore
            }
            return;
          }
          if (res.ok) {
            try {
              sessionStorage.setItem(SYNCED_AT_KEY, new Date().toISOString());
            } catch {
              // ignore
            }
            if (mounted.current) router.refresh();
          } else {
            try {
              sessionStorage.setItem(FAILED_AT_KEY, new Date().toISOString());
            } catch {
              // ignore
            }
            console.warn("[calendar] background sync failed", res.status);
          }
        })
        .catch((e) => {
          try {
            sessionStorage.setItem(FAILED_AT_KEY, new Date().toISOString());
          } catch {
            // ignore
          }
          console.warn("[calendar] background sync failed", e);
        })
        .finally(() => {
          inFlight = null;
        });
    }

    return () => {
      mounted.current = false;
    };
  }, [stale, router]);

  return null;
}
