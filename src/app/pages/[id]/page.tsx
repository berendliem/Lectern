import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageDetailHeader } from "@/components/page-detail/PageDetailHeader";
import { PipelineStatusBanner } from "@/components/page-detail/PipelineStatusBanner";
import { PageTabs } from "@/components/page-detail/PageTabs";
import { TranscriptTab } from "@/components/page-detail/TranscriptTab";
import { NotesView } from "@/components/page-detail/NotesView";
import { FlashcardList } from "@/components/flashcards/FlashcardList";
import type { TranscriptSegment, KeyTerm } from "@/types";

export default async function PageDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: {
      folder: true,
      transcript: true,
      notes: true,
      flashcards: { orderBy: { createdAt: "asc" } },
      quizQuestions: { orderBy: { createdAt: "asc" } },
      tags: { include: { tag: true } },
    },
  });
  if (!page) notFound();

  const segments: TranscriptSegment[] = page.transcript ? JSON.parse(page.transcript.segments) : [];
  const keyTerms: KeyTerm[] = page.notes ? JSON.parse(page.notes.keyTerms) : [];

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageDetailHeader pageId={page.id} title={page.title} status={page.status} folder={page.folder} />

      <PipelineStatusBanner
        pageId={page.id}
        status={page.status}
        errorMessage={page.errorMessage}
        hasAudio={!!page.audioFilePath}
        hasTranscript={!!page.transcript}
        hasNotes={!!page.notes}
        hasGuide={page.flashcards.length > 0 && page.quizQuestions.length > 0}
      />

      <PageTabs
        tabs={[
          {
            id: "transcript",
            label: "Transcript",
            content: (
              <TranscriptTab
                pageId={page.id}
                hasAudio={!!page.audioFilePath}
                transcript={page.transcript?.rawText ?? null}
                segments={segments}
              />
            ),
          },
          {
            id: "notes",
            label: "Notes",
            content: page.notes ? (
              <NotesView markdown={page.notes.markdown} keyTerms={keyTerms} />
            ) : (
              <EmptyState message="Notes will appear here once the transcript has been summarized." />
            ),
          },
          {
            id: "flashcards",
            label: `Flashcards${page.flashcards.length ? ` (${page.flashcards.length})` : ""}`,
            content:
              page.flashcards.length > 0 ? (
                <FlashcardList flashcards={page.flashcards} />
              ) : (
                <EmptyState message="Flashcards will appear here once the learning guide has been generated." />
              ),
          },
          {
            id: "quiz",
            label: `Quiz${page.quizQuestions.length ? ` (${page.quizQuestions.length})` : ""}`,
            content:
              page.quizQuestions.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {page.quizQuestions.map((q) => (
                    <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-sm font-medium text-slate-900">{q.prompt}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState message="Quiz questions will appear here once the learning guide has been generated." />
              ),
          },
        ]}
      />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}
