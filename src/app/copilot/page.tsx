import { LiveCopilot } from "@/components/copilot/LiveCopilot";

export const dynamic = "force-dynamic";

export default function CopilotPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Live copilot</h1>
        <p className="mt-0.5 text-[13px] text-zinc-400">
          Transcribes a meeting or study session in real time and suggests talking points, likely follow-ups, and a running
          summary.
        </p>
      </div>
      <LiveCopilot />
    </div>
  );
}
