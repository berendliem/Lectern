import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { classifyTopic, coverageThreshold, type CoverageState, type TopicMatch } from "@/lib/coverage";
import { scoreTopics } from "@/lib/embeddings";

export const runtime = "nodejs";

// Per-topic syllabus coverage. Same logic the course page runs inline in
// buildTopicRows(); this returns it without the UI's hrefs and mastery
// roll-up, which need card rows the agent has no use for.
export async function GET(_req: unknown, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const topics = await db.courseTopic.findMany({
    where: { folderId: id },
    orderBy: { order: "asc" },
    select: { id: true, title: true, week: true },
  });
  if (topics.length === 0) {
    return NextResponse.json({ coverage: "no-sources" satisfies CoverageState, topics: [] });
  }

  let matches: (TopicMatch | null)[];
  let coverage: CoverageState;
  try {
    const scores = await scoreTopics(
      id,
      topics.map((t: { title: string }) => t.title)
    );
    matches = scores.matches;
    // The syllabus itself is excluded from scoring, so a course whose only
    // indexed material is its syllabus has nothing to check against.
    coverage = scores.indexed ? "scored" : "no-sources";
  } catch (e) {
    console.error(`[coverage] scoring topics for course ${id} failed:`, e);
    matches = topics.map(() => null);
    coverage = "failed";
  }

  const threshold = coverageThreshold();
  return NextResponse.json({
    coverage,
    topics: topics.map((topic: { id: string; title: string; week: number | null }, i: number) => {
      const { covered, match } = classifyTopic(matches[i], threshold);
      return {
        id: topic.id,
        title: topic.title,
        week: topic.week,
        covered,
        match: match
          ? { title: match.title, score: Number(match.score.toFixed(3)), pageId: match.pageId }
          : null,
      };
    }),
  });
}
