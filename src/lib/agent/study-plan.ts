import { spawn } from "node:child_process";
import readline from "node:readline";
import { claudeArgs, claudeBinary } from "@/lib/agent/args";
import { parseAgentLine, type AgentEvent } from "@/lib/agent/stream";
import { STUDY_PLAN_SYSTEM_PROMPT, buildStudyPlanPrompt } from "@/lib/prompts/study-plan";

// ponytail: five minutes covers a plan that makes twenty tool calls on a cold
// embedding model. There is no --max-turns in the installed CLI build, so this
// is the only ceiling on a run — same reasoning as CHILD_TIMEOUT_MS in
// mac-speech.ts. Raise it if honest plans start hitting it.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function timeoutMs(): number {
  const raw = Number(process.env.AGENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Runs one study-plan agent and yields its events as they arrive.
 *
 * The child is bounded three ways: the caller's AbortSignal (the user closed
 * the panel), the spawn timeout (a wedged run), and stdout closing. Killing
 * `claude` closes the MCP server's stdio, so the three-process tree collapses
 * from the top.
 */
export async function* runStudyPlan(opts: {
  folderId: string;
  courseName: string;
  topics: string[];
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const args = claudeArgs({
    folderId: opts.folderId,
    prompt: buildStudyPlanPrompt({ courseName: opts.courseName, topics: opts.topics }),
    systemPrompt: STUDY_PLAN_SYSTEM_PROMPT,
  });

  // The test harness runs a stub script through node in place of the CLI.
  const fake = process.env.AGENT_FAKE_SCRIPT;
  const child = spawn(claudeBinary(), fake ? [fake] : args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs(),
    signal: opts.signal,
    cwd: process.cwd(),
  });

  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const failure = new Promise<never>((_resolve, reject) => {
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        reject(
          new Error(
            `The "${claudeBinary()}" command was not found. Install Claude Code and sign in, or set CLAUDE_BIN to its path.`
          )
        );
      } else {
        reject(e);
      }
    });
  });
  // Nothing awaits this unless the child errors; without a handler an early
  // rejection would surface as an unhandled rejection.
  failure.catch(() => undefined);

  let sawResult = false;
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

  try {
    // Racing each line against the error promise turns a spawn failure into a
    // thrown error at the call site rather than a generator that ends empty.
    const iterator = lines[Symbol.asyncIterator]();
    for (;;) {
      const next = await Promise.race([iterator.next(), failure]);
      if (next.done) break;
      const event = parseAgentLine(next.value);
      if (!event) continue;
      if (event.type === "result") sawResult = true;
      yield event;
    }
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }

  if (!sawResult) {
    const detail = Buffer.concat(stderr).toString("utf8").trim().split("\n").at(-1);
    throw new Error(detail || `${claudeBinary()} exited without producing a plan`);
  }
}
