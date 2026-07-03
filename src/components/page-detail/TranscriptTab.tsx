import { RecordingPanel } from "@/components/recording/RecordingPanel";
import { AudioUploadDropzone } from "@/components/recording/AudioUploadDropzone";
import { TranscriptView } from "@/components/page-detail/TranscriptView";
import type { TranscriptSegment } from "@/types";

export function TranscriptTab({
  pageId,
  hasAudio,
  isVideo,
  transcript,
  segments,
}: {
  pageId: string;
  hasAudio: boolean;
  isVideo: boolean;
  transcript: string | null;
  segments: TranscriptSegment[];
}) {
  const src = `/api/pages/${pageId}/audio`;
  return (
    <div className="flex flex-col gap-5">
      {hasAudio &&
        (isVideo ? (
          <video controls src={src} className="max-h-80 w-full rounded-xl bg-black" />
        ) : (
          <audio controls src={src} className="w-full" />
        ))}

      {!hasAudio && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RecordingPanel pageId={pageId} />
          <AudioUploadDropzone pageId={pageId} />
        </div>
      )}

      {transcript ? (
        <TranscriptView rawText={transcript} segments={segments} />
      ) : hasAudio ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-400">
          Audio saved. Use the banner above to transcribe it and generate study materials.
        </div>
      ) : null}
    </div>
  );
}
