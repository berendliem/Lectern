import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageDetailHeader } from "@/components/page-detail/PageDetailHeader";
import { PipelineStatusBanner } from "@/components/page-detail/PipelineStatusBanner";
import { PageTabs } from "@/components/page-detail/PageTabs";
import { TranscriptTab } from "@/components/page-detail/TranscriptTab";
import { NotesTab } from "@/components/page-detail/NotesTab";
import { FlashcardList } from "@/components/flashcards/FlashcardList";
import { QuizRunner, type QuizQuestionForRunner } from "@/components/quiz/QuizRunner";
import { ChatTab } from "@/components/page-detail/ChatTab";
import { ConceptMapTab } from "@/components/page-detail/ConceptMapTab";
import { ActionsTab } from "@/components/page-detail/ActionsTab";
import { InterviewLaunch } from "@/components/interview/InterviewLaunch";
import { LectureActions } from "@/components/page-detail/LectureActions";
import { isVideoExtension } from "@/lib/audio-storage";
import type { TranscriptSegment, KeyTerm } from "@/types";

export const dynamic = "force-dynamic";

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
  const audioExt = page.audioFilePath?.split(".").pop() ?? "";
  const isVideo = isVideoExtension(audioExt);

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageDetailHeader
        pageId={page.id}
        title={page.title}
        status={page.status}
        folder={page.folder}
        tags={page.tags.map((t) => t.tag)}
      />

      <PipelineStatusBanner
        pageId={page.id}
        errorMessage={page.errorMessage}
        hasAudio={!!page.audioFilePath}
        hasTranscript={!!page.transcript}
        hasNotes={!!page.notes}
        hasFlashcards={page.flashcards.length > 0}
        hasQuiz={page.quizQuestions.length > 0}
      />

      {page.notes && <InterviewLaunch pageId={page.id} pageTitle={page.title} />}

      <LectureActions pageId={page.id} />

      <PageTabs
        tabs={[
          {
            id: "transcript",
            label: "Transcript",
            content: (
              <TranscriptTab
                pageId={page.id}
                hasAudio={!!page.audioFilePath}
                isVideo={isVideo}
                transcript={page.transcript?.rawText ?? null}
                cleanText={page.transcript?.cleanText ?? null}
                chapters={page.transcript?.chapters ? JSON.parse(page.transcript.chapters) : []}
                segments={segments}
              />
            ),
          },
          {
            id: "notes",
            label: "Notes",
            content: page.notes ? (
              <NotesTab pageId={page.id} markdown={page.notes.markdown} keyTerms={keyTerms} />
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
                <QuizRunner questions={sanitizeQuizQuestions(page.quizQuestions)} />
              ) : (
                <EmptyState message="Quiz questions will appear here once the learning guide has been generated." />
              ),
          },
          {
            id: "actions",
            label: "Actions",
            content: <ActionsTab pageId={page.id} hasTranscript={!!page.transcript} />,
          },
          {
            id: "concept-map",
            label: "Concept map",
            content: <ConceptMapTab pageId={page.id} hasMaterial={!!page.transcript || !!page.notes} />,
          },
          {
            id: "chat",
            label: "Chat",
            content: <ChatTab pageId={page.id} hasMaterial={!!page.transcript || !!page.notes} />,
          },
        ]}
      />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted-2">
      {message}
    </div>
  );
}

function sanitizeQuizQuestions(
  questions: { id: string; type: "SHORT_ANSWER" | "MULTIPLE_CHOICE"; prompt: string; options: string | null }[]
): QuizQuestionForRunner[] {
  return questions.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options ? JSON.parse(q.options) : null,
  }));
}
