// NOTE: minimal foundation stub. The interview feature subagent replaces this
// with the interview hub: start-from-topic form + list of past sessions.
export const dynamic = "force-dynamic";

export default function InterviewHubPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Interview</h1>
        <p className="mt-0.5 text-[13px] text-zinc-400">Practice out loud with an AI interviewer that adapts to your answers.</p>
      </div>
      <p className="text-sm text-zinc-400">Coming online…</p>
    </div>
  );
}
