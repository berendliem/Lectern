import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCheck, GraduationCap, Lightbulb, MessagesSquare } from "lucide-react";
import { db } from "@/lib/db";
import { courseScopeFilter, quizlessMaterialsFilter } from "@/lib/cards";
import {
  classifyTopic,
  coverageThreshold,
  rollUpMastery,
  type CoverageState,
  type TopicMatch,
} from "@/lib/coverage";
import { scoreTopics } from "@/lib/embeddings";
import { RECALL_LEDGER_SINCE } from "@/lib/recall";
import { CourseOverview, type TopicRow } from "@/components/course/CourseOverview";
import { PageList } from "@/components/dashboard/PageList";
import { NewPageButton } from "@/components/dashboard/NewPageButton";
import { ImportButton } from "@/components/dashboard/ImportButton";
import { TranscriptImportButton } from "@/components/dashboard/TranscriptImportButton";
import { FolderHeader } from "@/components/dashboard/FolderHeader";
import { PageTabs } from "@/components/page-detail/PageTabs";
import { MaterialUploadButton } from "@/components/dashboard/MaterialUploadButton";
import { OnqImportButton } from "@/components/dashboard/OnqImportButton";
import { MaterialList } from "@/components/dashboard/MaterialList";
import { CourseChat } from "@/components/ask/CourseChat";
import { CourseDropZone } from "@/components/dashboard/CourseDropZone";

export const dynamic = "force-dynamic";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) notFound();

  const [pages, quizCount, quizlessCount, dueCount, materials, topics, cards, openMisconceptions] = await Promise.all([
    db.page.findMany({
      where: { folderId },
      orderBy: { updatedAt: "desc" },
      include: {
        folder: true,
        tags: { include: { tag: true } },
        _count: { select: { flashcards: true, quizQuestions: true } },
      },
    }),
    db.quizQuestion.count({ where: courseScopeFilter(folderId) }),
    // Materials with no questions yet still open cram: the cram page generates them.
    db.material.count({ where: quizlessMaterialsFilter(folderId) }),
    db.flashcard.count({
      where: { nextReviewAt: { lte: new Date() }, ...courseScopeFilter(folderId) },
    }),
    db.material.findMany({
      where: { folderId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        title: true,
        sourceFileName: true,
        slideCount: true,
        createdAt: true,
        _count: { select: { flashcards: true, quizQuestions: true } },
      },
    }),
    db.courseTopic.findMany({ where: { folderId }, orderBy: { order: "asc" } }),
    db.flashcard.findMany({
      where: courseScopeFilter(folderId),
      select: { pageId: true, materialId: true, repetitions: true, lastReviewedAt: true },
    }),
    // What this course got wrong and has not since got right. A scored read, so
    // it starts at the ledger — backfilled rows carry no diagnosis anyway, but
    // the filter is the habit that keeps the next such read honest.
    db.reviewLog.findMany({
      where: {
        reviewedAt: { gte: RECALL_LEDGER_SINCE },
        resolvedAt: null,
        misconception: { not: null },
        OR: [{ page: { folderId } }, { material: { folderId } }],
      },
      orderBy: { reviewedAt: "desc" },
      take: 20,
      select: {
        id: true,
        misconception: true,
        page: { select: { title: true } },
        material: { select: { title: true } },
      },
    }),
  ]);

  // Without a verdict every topic would read as uncovered, which is not what
  // "nothing to score against" means. Coverage stays silent instead, and says
  // which of the two reasons it is.
  const { rows: topicRows, coverage } = await buildTopicRows(folderId, topics, cards);
  const hasSyllabus = materials.some((m) => m.kind === "SYLLABUS");
  const uncovered = coverage === "scored" ? topicRows.filter((t) => !t.covered).length : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">{folder.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {dueCount > 0 && (
            <Link
              href={`/folders/${folder.id}/review`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border bg-brand-soft/40 px-3 py-2 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-soft"
            >
              <CheckCheck className="h-4 w-4" strokeWidth={2} />
              Review {dueCount}
            </Link>
          )}
          {(quizCount > 0 || quizlessCount > 0) && (
            <Link
              href={`/folders/${folder.id}/cram`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-brand transition-opacity hover:opacity-95"
            >
              <GraduationCap className="h-4 w-4" strokeWidth={2} />
              Exam cram
            </Link>
          )}
          <Link
            href={`/feynman?folderId=${folder.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <Lightbulb className="h-4 w-4" strokeWidth={2} />
            Feynman
          </Link>
          <Link
            href={`/interview?folderId=${folder.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <MessagesSquare className="h-4 w-4" strokeWidth={2} />
            Interview
          </Link>
          <NewPageButton folderId={folder.id} />
          <FolderHeader folderId={folder.id} name={folder.name} />
        </div>
      </div>

      {/* Wraps the whole tab area rather than the Materials tab alone: a drop
          can hold both slides and transcripts, and the user should not have to
          guess which tab it belongs to. */}
      <CourseDropZone folderId={folder.id}>
        <PageTabs
          tabs={[
            {
              id: "overview",
              label: uncovered > 0 ? `Overview (${uncovered} uncovered)` : "Overview",
              content: (
                <CourseOverview
                  folderId={folder.id}
                  topics={topicRows}
                  hasSyllabus={hasSyllabus}
                  coverage={coverage}
                  misconceptions={openMisconceptions.map((m) => ({
                    id: m.id,
                    // The query filters `misconception: { not: null }`; Prisma
                    // just cannot carry that through to the return type.
                    text: m.misconception as string,
                    source: m.page?.title ?? m.material?.title ?? null,
                  }))}
                />
              ),
            },
            {
              id: "lectures",
              label: `Lectures (${pages.length})`,
              content: (
                <div className="flex flex-col gap-4">
                  <div className="flex justify-end gap-2">
                    <TranscriptImportButton folderId={folder.id} />
                    <ImportButton folderId={folder.id} />
                  </div>
                  <PageList pages={pages} />
                </div>
              ),
            },
            {
              id: "materials",
              label: `Materials (${materials.length})`,
              content: (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-end gap-2">
                    <OnqImportButton folderId={folder.id} folderName={folder.name} />
                    <MaterialUploadButton folderId={folder.id} />
                  </div>
                  <MaterialList
                    folderId={folder.id}
                    materials={materials.map((m) => ({
                      id: m.id,
                      kind: m.kind,
                      title: m.title,
                      sourceFileName: m.sourceFileName,
                      slideCount: m.slideCount,
                      createdAt: m.createdAt,
                      flashcardCount: m._count.flashcards,
                      quizCount: m._count.quizQuestions,
                    }))}
                  />
                </div>
              ),
            },
            {
              id: "ask",
              label: "Ask",
              content: <CourseChat folderId={folder.id} />,
            },
          ]}
        />
      </CourseDropZone>
    </div>
  );
}

type TopicRecord = { id: string; title: string; week: number | null };
type CardRecord = {
  pageId: string | null;
  materialId: string | null;
  repetitions: number;
  lastReviewedAt: Date | null;
};

/**
 * Coverage for the whole syllabus in one embedding pass. Embedding can fail
 * (model download, provider outage) and the course page must still render, so
 * a failure degrades to "no match known" rather than an error page.
 */
async function buildTopicRows(
  folderId: string,
  topics: TopicRecord[],
  cards: CardRecord[]
): Promise<{ rows: TopicRow[]; coverage: CoverageState }> {
  if (topics.length === 0) return { rows: [], coverage: "no-sources" };

  let matches: (TopicMatch | null)[];
  let coverage: CoverageState;
  try {
    const scores = await scoreTopics(folderId, topics.map((t) => t.title));
    matches = scores.matches;
    // The syllabus itself is excluded from scoring, so a course whose only
    // indexed material is its syllabus has nothing to check against.
    coverage = scores.indexed ? "scored" : "no-sources";
  } catch (e) {
    console.error(`[coverage] scoring topics for course ${folderId} failed:`, e);
    matches = topics.map(() => null);
    coverage = "failed";
  }

  const threshold = coverageThreshold();
  const cardsBySource = new Map<string, CardRecord[]>();
  for (const card of cards) {
    const key = card.pageId ? `p:${card.pageId}` : card.materialId ? `m:${card.materialId}` : null;
    if (!key) continue;
    const list = cardsBySource.get(key);
    if (list) list.push(card);
    else cardsBySource.set(key, [card]);
  }

  const rows = topics.map((topic, i) => {
    const { covered, match } = classifyTopic(matches[i], threshold);
    const key = match?.pageId ? `p:${match.pageId}` : match?.materialId ? `m:${match.materialId}` : null;
    return {
      id: topic.id,
      title: topic.title,
      week: topic.week,
      covered,
      matchTitle: match?.title ?? null,
      // Materials have no page of their own to link to.
      matchHref: match?.pageId ? `/pages/${match.pageId}` : null,
      // Mastery of what the covering source actually teaches you, which is
      // only meaningful once that source has cards.
      mastery: covered && key ? rollUpMastery(cardsBySource.get(key) ?? []) : null,
    };
  });

  return { rows, coverage };
}
