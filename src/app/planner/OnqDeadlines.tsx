import { Check } from "lucide-react";
import clsx from "@/lib/clsx";
import { dayLabel, groupByDay } from "@/lib/calendar-events";
import { onqWhatsDue } from "@/lib/mcp/onq";
import type { OnqDueItem } from "@/lib/mcp/onq-parse";

const KIND_LABEL: Record<string, string> = { assignment: "Assignment", quiz: "Quiz" };

// onQ names an offering "CISC 102 001 / CISC 102 002 Discrete Structures I F26";
// the code is what tells two deadlines apart at a glance.
function courseCode(name: string): string {
  return name.match(/[A-Z]{3,4} ?\d{3}/)?.[0] ?? name;
}

const clock = (d: Date) => d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });

// A quiz is a sitting: "20:00–21:00 · 40 min". One that opens on an earlier
// day than it closes names that day instead, since the row's own time is the close.
function sitting(item: OnqDueItem, now: Date): string | null {
  const parts: string[] = [];
  if (item.opens) {
    parts.push(
      item.opens.toDateString() === item.due.toDateString()
        ? `${clock(item.opens)}–${clock(item.due)}`
        : `opens ${dayLabel(item.opens, now)} ${clock(item.opens)}`
    );
  }
  if (item.timeLimitMinutes) parts.push(`${item.timeLimitMinutes} min`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// id alone is not enough: it is null from an older onq-mcp, and an overdue
// item's id is a content id that can equal some quiz's.
const itemKey = (i: OnqDueItem) => `${i.course}|${i.kind}|${i.id}|${i.name}`;

function Item({ item, when, now }: { item: OnqDueItem; when: string; now: Date }) {
  const detail = sitting(item, now);
  return (
    <li className="flex items-center gap-3 text-[13px]">
      <span className="w-12 shrink-0 tabular-nums text-muted">{when}</span>
      <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">
        {courseCode(item.course)}
      </span>
      <span className={clsx("truncate", item.completed ? "text-muted line-through" : "text-ink")}>{item.name}</span>
      {detail && <span className="shrink-0 tabular-nums text-muted">{detail}</span>}
      {item.completed && (
        <>
          <Check className="h-3.5 w-3.5 shrink-0 text-moss-ink" strokeWidth={2.5} aria-hidden />
          <span className="sr-only">Completed</span>
        </>
      )}
      {KIND_LABEL[item.kind] && (
        <span className="ml-auto shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
          {KIND_LABEL[item.kind]}
        </span>
      )}
    </li>
  );
}

/** Fetches live on every render: wrap in Suspense so onQ never holds the page. */
export default async function OnqDeadlines({ days, now }: { days: number; now: Date }) {
  let items: OnqDueItem[];
  try {
    items = await onqWhatsDue(days);
  } catch (e) {
    // Usually onq-mcp's own "session expired, log in again". Anything else is
    // shown as-is too: Lectern is a local, single-user app.
    return <p className="text-[13px] text-muted-2">{e instanceof Error ? e.message : "Could not reach onQ."}</p>;
  }

  // groupByDay only merges neighbours, so the order is Lectern's to guarantee.
  items = items.toSorted((a, b) => a.due.getTime() - b.due.getTime());
  const overdue = items.filter((i) => i.overdue);
  const groups = groupByDay(
    items.filter((i) => !i.overdue).map((i) => ({ ...i, start: i.due })),
    now
  );
  if (items.length === 0) return <p className="text-[13px] text-muted-2">Nothing due on onQ in this window.</p>;

  return (
    <ol className="flex flex-col gap-4">
      {overdue.length > 0 && (
        <li>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-coral-ink">Overdue</p>
          <ul className="flex flex-col gap-1.5">
            {overdue.map((i) => (
              <Item key={itemKey(i)} item={i} when={dayLabel(i.due, now)} now={now} />
            ))}
          </ul>
        </li>
      )}
      {groups.map((g) => (
        <li key={g.key}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-2">{g.label}</p>
          <ul className="flex flex-col gap-1.5">
            {g.events.map((i) => (
              <Item key={itemKey(i)} item={i} when={clock(i.due)} now={now} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
