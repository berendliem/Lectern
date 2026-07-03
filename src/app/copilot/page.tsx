// NOTE: minimal foundation stub. The copilot feature subagent replaces this
// with the live meeting/study copilot: capture audio in chunks, transcribe via
// the whisper service, and surface suggested talking points + a live summary.
export const dynamic = "force-dynamic";

export default function CopilotPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Live copilot</h1>
        <p className="mt-0.5 text-[13px] text-zinc-400">
          Transcribes a meeting or study session in real time and suggests talking points. Use it openly on your own screen.
        </p>
      </div>
      <p className="text-sm text-zinc-400">Coming online…</p>
    </div>
  );
}
