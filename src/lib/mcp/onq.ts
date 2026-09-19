import { callMcpToolJson } from "@/lib/mcp/client";
import { loadMcpServers } from "@/lib/mcp/config";
import {
  parseOnqCourses,
  parseOnqDueItems,
  parseOnqModules,
  parseOnqTopicText,
  type OnqCourse,
  type OnqDueItem,
  type OnqModule,
  type OnqTopicText,
} from "@/lib/mcp/onq-parse";

export const ONQ_SERVER = "onq";

// read_topic downloads the file from onQ and converts it to markdown; a large
// scanned PDF takes far longer than the client's 60s default.
const READ_TOPIC_TIMEOUT_MS = 120_000;

export async function isOnqConfigured(): Promise<boolean> {
  const servers = await loadMcpServers().catch(() => ({}));
  return ONQ_SERVER in servers;
}

export async function listOnqCourses(): Promise<OnqCourse[]> {
  return parseOnqCourses(await callMcpToolJson(ONQ_SERVER, "list_courses", { active_only: true }));
}

export async function onqCourseContent(courseId: number): Promise<OnqModule[]> {
  return parseOnqModules(await callMcpToolJson(ONQ_SERVER, "course_content", { course_id: courseId }));
}

export async function readOnqTopic(courseId: number, topicId: number): Promise<OnqTopicText> {
  return parseOnqTopicText(
    await callMcpToolJson(
      ONQ_SERVER,
      "read_topic",
      { course_id: courseId, topic_id: topicId },
      { timeoutMs: READ_TOPIC_TIMEOUT_MS }
    )
  );
}

export async function onqWhatsDue(days: number): Promise<OnqDueItem[]> {
  return parseOnqDueItems(await callMcpToolJson(ONQ_SERVER, "whats_due", { days }));
}
