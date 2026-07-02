import { RecordingPanel } from "@/components/recording/RecordingPanel";
import { AudioUploadDropzone } from "@/components/recording/AudioUploadDropzone";
import { TranscriptView } from "@/components/page-detail/TranscriptView";
import type { TranscriptSegment } from "@/types";

export function TranscriptTab({
  pageId,
  hasAudio,
  transcript,
  segments,
}: {
  pageId: string;
  hasAudio: boolean;
  transcript: string | null;
  segments: TranscriptSegment[];
}) {
  return (
    <div className="flex flex-col gap-5">
      {hasAudio && <audio controls src={`/api/pages/${pageId}/audio`} className="w-full" />}

      {!hasAudio && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RecordingPanel pageId={pageId} />
          <AudioUploadDropzone pageId={pageId} />
        </div>
      )}

      {transcript ? (
        <TranscriptView rawText={transcript} segments={segments} />
      ) : hasAudio ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">
          Audio saved. Use the banner above to transcribe it and generate study materials.
        </div>
      ) : null}
    </div>
  );
}
