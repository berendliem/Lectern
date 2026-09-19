// The shapes onq-mcp's tools return, read into Lectern's own types. Kept free
// of the MCP client so it can be tested without spawning a server. The
// snake_case field names are a contract with onq-mcp (see its README, "Using
// from Lectern"); unknown keys are ignored so it can add fields freely.
import { z } from "zod";

export type OnqCourse = { courseId: number; name: string };
export type OnqTopic = {
  topicId: number;
  title: string;
  extension: string | null;
  downloadable: boolean;
  lastModified: string | null;
};
export type OnqModule = { moduleId: number; title: string; topics: OnqTopic[] };
export type OnqTopicText = OnqTopic & {
  text: string | null;
  note: string | null;
  sourceFileName: string | null;
};
export type OnqDueItem = {
  course: string;
  kind: string;
  id: number | null;
  name: string;
  due: Date;
  /** null: onQ does not report the student's progress on this item. */
  completed: boolean | null;
  overdue: boolean;
  /** Quizzes only: `due` is when one closes, this is when it opens. */
  opens: Date | null;
  /** Quizzes only: how long one attempt may run. */
  timeLimitMinutes: number | null;
};

// Length caps: these strings are stored and shown as-is, and onq-mcp relays
// whatever the course author typed.
const title = z
  .string()
  .max(300)
  .nullish()
  .transform((t) => t?.trim() || "Untitled");

const courseSchema = z.object({ course_id: z.number().int(), name: z.string() });

// `downloadable` and `last_modified` default rather than fail: an onq-mcp from
// before those fields existed then reads as "nothing here can be imported",
// which the dialog shows plainly, instead of an opaque parse error.
const topicSchema = z.object({
  topic_id: z.number().int(),
  title,
  extension: z.string().max(300).nullish().default(null),
  downloadable: z.boolean().default(false),
  last_modified: z.string().max(64).nullish().default(null),
});

const moduleSchema = z.object({ module_id: z.number().int(), title, topics: z.array(topicSchema) });

const topicTextSchema = topicSchema.extend({
  text: z.string().nullable(),
  note: z.string().max(2000).nullish().default(null),
  source_file_name: z.string().max(300).nullish().default(null),
});

// `completed` and `overdue` default rather than fail, for the same reason as
// `downloadable` above. `kind` stays a string: onq-mcp names kinds Lectern has
// no special treatment for ("item").
const isoDate = z.iso.datetime({ offset: true }).transform((d) => new Date(d));

const dueItemSchema = z.object({
  course: z.string().max(300),
  kind: z.string().max(32),
  id: z.number().int().nullish().default(null),
  name: title,
  due: isoDate,
  completed: z.boolean().nullish().default(null),
  overdue: z.boolean().default(false),
  opens: isoDate.nullish().default(null),
  time_limit_minutes: z.number().int().positive().nullish().default(null),
});

function toTopic(t: z.output<typeof topicSchema>): OnqTopic {
  return {
    topicId: t.topic_id,
    title: t.title,
    extension: t.extension ?? null,
    downloadable: t.downloadable,
    lastModified: t.last_modified ?? null,
  };
}

function parse<T extends z.ZodType>(schema: T, raw: unknown, tool: string): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `onq-mcp's ${tool} returned a shape Lectern does not recognise. Update onq-mcp, then try again. (${result.error.issues[0]?.message ?? "unknown"})`
    );
  }
  return result.data;
}

export function parseOnqCourses(raw: unknown): OnqCourse[] {
  return parse(z.array(courseSchema), raw, "list_courses").map((c) => ({ courseId: c.course_id, name: c.name }));
}

export function parseOnqModules(raw: unknown): OnqModule[] {
  return parse(z.array(moduleSchema), raw, "course_content").map((m) => ({
    moduleId: m.module_id,
    title: m.title,
    topics: m.topics.map(toTopic),
  }));
}

export function parseOnqTopicText(raw: unknown): OnqTopicText {
  const t = parse(topicTextSchema, raw, "read_topic");
  return { ...toTopic(t), text: t.text, note: t.note ?? null, sourceFileName: t.source_file_name ?? null };
}

export function parseOnqDueItems(raw: unknown): OnqDueItem[] {
  return parse(z.array(dueItemSchema), raw, "whats_due").map(({ time_limit_minutes, ...i }) => ({
    ...i,
    timeLimitMinutes: time_limit_minutes,
  }));
}
