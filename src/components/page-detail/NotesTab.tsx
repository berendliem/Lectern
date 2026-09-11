"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, Square, Undo2, Wand2, X } from "lucide-react";
import { NotesView } from "@/components/page-detail/NotesView";
import { useMediaRecorder } from "@/components/recording/useMediaRecorder";
import { Button } from "@/components/ui/Button";
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";
import type { KeyTerm } from "@/types";

/**
 * Notes tab with Edit Mode (à la FreeFlow): select text in the notes and/or
 * give a typed or spoken instruction ("make this shorter", "turn this into a
 * table") and the LLM applies it to the notes.
 */
export function NotesTab({
  pageId,
  markdown: initialMarkdown,
  keyTerms,
}: {
  pageId: string;
  markdown: string;
  keyTerms: KeyTerm[];
}) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [instruction, setInstruction] = useState("");
  const [selectedText, setSelectedText] = useState<string | null>(null);
  // Only undo() sets this — applyEdit's in-flight state comes from the task below.
  const [undoBusy, setUndoBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previousMarkdown, setPreviousMarkdown] = useState<string | null>(null);
  const notesRef = useRef<HTMLDivElement>(null);

  const recorder = useMediaRecorder();
  const { run, task } = useTasks();
  const editKey = `page:${pageId}:edit-notes`;
  const editTask = task(editKey);
  const busy = editTask?.status === "running" || undoBusy;

  // Server refreshes (router.refresh after other pipeline steps) can change
  // the prop; adopt it unless we're mid-edit. Adjusting state during render
  // (not in an effect) is the sanctioned pattern for derived resets.
  const [prevInitialMarkdown, setPrevInitialMarkdown] = useState(initialMarkdown);
  if (initialMarkdown !== prevInitialMarkdown) {
    setPrevInitialMarkdown(initialMarkdown);
    if (!busy) {
      setMarkdown(initialMarkdown);
      // The notes changed server-side; an undo to the pre-edit snapshot would
      // silently clobber that newer content.
      setPreviousMarkdown(null);
    }
  }

  async function transcribeInstruction(blob: Blob) {
    setTranscribing(true);
    const formData = new FormData();
    formData.append("file", blob, "instruction.webm");
    try {
      const res = await fetch("/api/live-transcribe", { method: "POST", body: formData });
      const data = await res.json();
      if (data?.text) setInstruction((prev) => (prev ? `${prev} ${data.text}` : data.text));
      else if (data?.error) setError(data.error);
    } catch {
      setError("Could not transcribe the voice instruction.");
    } finally {
      setTranscribing(false);
    }
  }

  // When a voice instruction recording finishes, transcribe it locally and
  // append it to the instruction field.
  useEffect(() => {
    if (!recorder.audioBlob || recorder.status !== "stopped") return;
    const blob = recorder.audioBlob;
    recorder.reset();
    // Deferred (outside the effect's render pass), and deliberately WITHOUT a
    // cleanup: reset() changes this effect's own deps, so the re-run's cleanup
    // would cancel the timer before it ever fired.
    setTimeout(() => void transcribeInstruction(blob), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.audioBlob, recorder.status]);

  function captureSelection() {
    const selection = window.getSelection();
    const sel = selection?.toString().trim();
    const notes = notesRef.current;
    // Both ends of the selection must be inside the notes, or the captured
    // text can include content that isn't part of the notes markdown.
    if (
      sel &&
      sel.length >= 3 &&
      notes?.contains(selection?.anchorNode ?? null) &&
      notes?.contains(selection?.focusNode ?? null)
    ) {
      setSelectedText(sel.slice(0, 20_000));
    }
  }

  async function applyEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!instruction.trim() || busy) return;
    const before = markdown;
    await run(
      { key: editKey, label: "Applying your edit to the notes…", href: `/pages/${pageId}` },
      async ({ emit }) => {
        const body = (await postTask(`/api/pages/${pageId}/edit-notes`, "Could not apply that edit.", {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction: instruction.trim(),
            ...(selectedText ? { selectedText } : {}),
          }),
        })) as { markdown?: string };
        if (!body.markdown) throw new Error("Could not apply that edit.");
        emit(body.markdown);
      }
    );
    const applied = task(editKey);
    const next = applied?.status === "error" ? null : ((applied?.data as string | undefined) ?? null);
    if (next && next !== before) {
      setPreviousMarkdown(before);
      setMarkdown(next);
      setInstruction("");
      setSelectedText(null);
      router.refresh();
    }
  }

  async function undo() {
    if (!previousMarkdown) return;
    setUndoBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notesMarkdown: previousMarkdown }),
      });
      if (res.ok) {
        setMarkdown(previousMarkdown);
        setPreviousMarkdown(null);
        router.refresh();
      } else {
        setError("Could not undo the edit.");
      }
    } finally {
      setUndoBusy(false);
    }
  }

  const recording = recorder.status === "recording";

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={applyEdit}
        className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/60 p-3"
      >
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 shrink-0 text-brand-ink" strokeWidth={2.2} />
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={
              selectedText
                ? 'Edit the selection… e.g. "make this shorter", "turn this into a table"'
                : 'Edit the notes… e.g. "add a summary at the top", "simplify the jargon"'
            }
            maxLength={500}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted-2"
          />
          <button
            type="button"
            onClick={() => (recording ? recorder.stopRecording() : recorder.startRecording())}
            disabled={busy || transcribing}
            className={
              recording
                ? "rounded-lg bg-red-100 p-1.5 text-red-600"
                : "rounded-lg p-1.5 text-muted-2 transition-colors hover:bg-surface-3 hover:text-ink-soft"
            }
            aria-label={recording ? "Stop voice instruction" : "Speak the instruction"}
            title="Speak the instruction (transcribed locally)"
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <Square className="h-4 w-4" strokeWidth={2.2} />
            ) : (
              <Mic className="h-4 w-4" strokeWidth={2.2} />
            )}
          </button>
          <Button type="submit" size="sm" disabled={busy || !instruction.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
          </Button>
          {previousMarkdown && !busy && (
            <Button type="button" size="sm" variant="secondary" onClick={undo}>
              <Undo2 className="h-3.5 w-3.5" strokeWidth={2.2} />
              Undo
            </Button>
          )}
        </div>
        {selectedText && (
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <span className="shrink-0 font-medium text-ink-soft">Selection:</span>
            <span className="truncate">“{selectedText}”</span>
            <button
              type="button"
              onClick={() => setSelectedText(null)}
              className="rounded p-0.5 text-muted-2 hover:bg-surface-3 hover:text-ink-soft"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          </div>
        )}
        {recorder.error && <p className="text-[12.5px] text-red-600">{recorder.error}</p>}
        {(editTask?.error ?? error) && (
          <p className="text-[12.5px] text-red-600">{editTask?.error ?? error}</p>
        )}
      </form>

      <div ref={notesRef} onMouseUp={captureSelection}>
        <NotesView markdown={markdown} keyTerms={keyTerms} />
      </div>
    </div>
  );
}
