"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, CalendarPlus, CircleCheck, CircleDashed, Loader2, Plug, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

type ServerStatus = { name: string; command: string; connected: boolean };
type ParsedEvent = { title: string; start: string; end?: string; location?: string };

export function IntegrationsManager() {
  const [servers, setServers] = useState<ServerStatus[] | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  const [eventsText, setEventsText] = useState<string | null>(null);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importedPages, setImportedPages] = useState<Record<string, string>>({});
  const [scheduling, setScheduling] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/integrations")
      .then((res) => res.json())
      .then((data) => {
        if (ignore) return;
        setServers(data.servers ?? []);
        setConfigError(data.configError ?? null);
      })
      .catch(() => {
        if (!ignore) setServers([]);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const hasCalendar = servers?.some((s) => s.name === "google-calendar") ?? false;
  const hasNotion = servers?.some((s) => s.name === "notion") ?? false;

  async function testServer(name: string) {
    setTesting(name);
    setTestResults((prev) => ({ ...prev, [name]: "" }));
    try {
      const res = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: name }),
      });
      const body = await res.json().catch(() => ({}));
      setTestResults((prev) => ({
        ...prev,
        [name]: res.ok ? `Connected — ${body.toolCount} tools available` : (body.error ?? "Connection failed"),
      }));
      if (res.ok) {
        setServers((prev) => prev?.map((s) => (s.name === name ? { ...s, connected: true } : s)) ?? null);
      }
    } catch {
      setTestResults((prev) => ({ ...prev, [name]: "Connection failed" }));
    } finally {
      setTesting(null);
    }
  }

  async function loadEvents() {
    setLoadingEvents(true);
    setEventsError(null);
    try {
      const res = await fetch("/api/integrations/calendar/events?days=7");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEventsError(body.error ?? "Could not load calendar events");
      } else {
        setEventsText(body.text ?? "");
        setEvents(body.events ?? []);
      }
    } catch {
      setEventsError("Could not load calendar events");
    } finally {
      setLoadingEvents(false);
    }
  }

  async function importEvent(event: ParsedEvent) {
    const key = `${event.title}|${event.start}`;
    setImporting(key);
    try {
      const res = await fetch("/api/integrations/calendar/import-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: event.title, start: event.start }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.page) {
        setImportedPages((prev) => ({ ...prev, [key]: body.page.id }));
      }
    } finally {
      setImporting(null);
    }
  }

  async function scheduleReviews() {
    setScheduling(true);
    setScheduleResult(null);
    try {
      const res = await fetch("/api/integrations/calendar/schedule-reviews", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setScheduleResult(
        res.ok
          ? `Added review sessions to your calendar for: ${body.createdDays.join(", ")}`
          : (body.error ?? "Scheduling failed")
      );
    } catch {
      setScheduleResult("Scheduling failed");
    } finally {
      setScheduling(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-zinc-900">
          <Plug className="h-5 w-5 text-brand" strokeWidth={2.2} />
          Integrations
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-500">
          Connect MCP servers to organize and sync: pull your class schedule from Google Calendar,
          push notes to Notion. Configure servers in <code className="rounded bg-zinc-100 px-1 py-0.5 text-[12px]">mcp.config.json</code>{" "}
          (see <code className="rounded bg-zinc-100 px-1 py-0.5 text-[12px]">mcp.config.example.json</code>).
        </p>
      </div>

      {/* Server status */}
      <section className="flex flex-col gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-400">MCP servers</h2>
        {configError && <p className="text-sm text-red-600">{configError}</p>}
        {servers === null ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : servers.length === 0 && !configError ? (
          <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400">
            No MCP servers configured yet. Copy <code>mcp.config.example.json</code> to{" "}
            <code>mcp.config.json</code> and add your Notion token / Google credentials.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
            {servers.map((server) => (
              <li key={server.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {server.connected ? (
                  <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2.2} />
                ) : (
                  <CircleDashed className="h-4 w-4 shrink-0 text-zinc-300" strokeWidth={2.2} />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-800">{server.name}</p>
                  <p className="truncate font-mono text-[11.5px] text-zinc-400">{server.command}</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {testResults[server.name] && (
                    <span className="max-w-72 truncate text-[12.5px] text-zinc-500">{testResults[server.name]}</span>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => testServer(server.name)} disabled={testing !== null}>
                    {testing === server.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Google Calendar */}
      {hasCalendar && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-zinc-400">
              <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.2} />
              This week&apos;s schedule
            </h2>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={scheduleReviews} disabled={scheduling}>
                {scheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
                Add review sessions to calendar
              </Button>
              <Button size="sm" onClick={loadEvents} disabled={loadingEvents}>
                {loadingEvents ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {eventsText === null ? "Load events" : "Reload"}
              </Button>
            </div>
          </div>
          {scheduleResult && <p className="text-[12.5px] text-zinc-500">{scheduleResult}</p>}
          {eventsError && <p className="text-sm text-red-600">{eventsError}</p>}

          {events.length > 0 ? (
            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
              {events.map((event) => {
                const key = `${event.title}|${event.start}`;
                const pageId = importedPages[key];
                return (
                  <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800">{event.title}</p>
                      <p className="text-[12.5px] text-zinc-400">
                        {event.start.replace("T", " ")}
                        {event.end ? ` – ${event.end.replace("T", " ")}` : ""}
                        {event.location ? ` · ${event.location}` : ""}
                      </p>
                    </div>
                    <div className="ml-auto">
                      {pageId ? (
                        <Link href={`/pages/${pageId}`} className="text-[12.5px] font-medium text-brand hover:underline">
                          Open page →
                        </Link>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => importEvent(event)} disabled={importing !== null}>
                          {importing === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create lecture page"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : eventsText !== null && !loadingEvents ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[12.5px] leading-5 text-zinc-600">
              {eventsText || "No upcoming events."}
            </pre>
          ) : null}
        </section>
      )}

      {/* Notion */}
      {hasNotion && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-400">Notion</h2>
          <p className="text-sm text-zinc-500">
            Use <span className="font-medium text-zinc-700">Export → Sync to Notion</span> on any page to push its notes,
            key terms, action items, flashcards, and transcript to a Notion page (created under the parent page set by{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-[12px]">NOTION_PARENT_PAGE_ID</code>). Re-syncing
            updates the same Notion page.
          </p>
        </section>
      )}
    </div>
  );
}
