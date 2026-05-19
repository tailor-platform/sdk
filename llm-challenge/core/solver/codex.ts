import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { parseCodexStreamLine } from "../trace";
import type { TraceEvent } from "../trace";
import { buildContainerRunArgs, ensureImage } from "./container";
import { detectInfraFailure } from "./shared";
import type {
  AuthCheckResult,
  SolveAdapter,
  SolveResult,
  SolveRunOptions,
  SolveUsage,
} from "./types";

/**
 * Hardcoded model id. The challenge benchmark is bound to a single OpenAI
 * model — varying it is an experiment-level decision that lives outside this
 * code path. Update this constant when migrating to a new flagship.
 */
const CODEX_MODEL = "gpt-5.5";

/**
 * Resolve the host-side path to `auth.json` written by `codex login`.
 * Respects `CODEX_HOME` so users with non-standard layouts can point at it
 * without touching this file.
 */
export function resolveHostCodexAuthPath(): string {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome && codexHome.length > 0) {
    return path.join(codexHome, "auth.json");
  }
  return path.join(os.homedir(), ".codex", "auth.json");
}

/**
 * Write a single trace event synchronously. Failures are swallowed and logged
 * to stderr; the run must continue even if we lose the trace.
 */
function writeTraceEventSync(filePath: string, event: TraceEvent): void {
  try {
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`warn: failed to append trace event: ${message}\n`);
  }
}

async function runCodex(options: SolveRunOptions): Promise<SolveResult> {
  await ensureImage();

  const { prompt, workDir, effort, tracePath, maxSeconds } = options;
  const codexAuthPath = resolveHostCodexAuthPath();

  // `codex exec --json` reads the prompt from stdin when the positional
  // argument is `-`, emits newline-delimited events on stdout, and never
  // requires interactive approval thanks to `--dangerously-bypass-approvals-and-sandbox`.
  // Container-level isolation (Podman) is the actual containment boundary —
  // codex's own sandbox layer is redundant in this configuration.
  const cliArgs = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--cd",
    "/workspace",
    "--dangerously-bypass-approvals-and-sandbox",
    "-m",
    CODEX_MODEL,
    "-c",
    `model_reasoning_effort=${effort}`,
    "-",
  ];

  const containerArgs = buildContainerRunArgs(cliArgs, { workDir, codexAuthPath });
  const startTime = Date.now();
  // Per-problem wall-clock cap. Defaults to 3600 s (60 min) when caller did
  // not set --max-seconds; the same default the CLI applies.
  const timeout = (maxSeconds ?? 3600) * 1000;

  if (tracePath) {
    try {
      fs.writeFileSync(tracePath, "");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`warn: failed to initialise trace file ${tracePath}: ${message}\n`);
    }
  }

  return new Promise<SolveResult>((resolve) => {
    const proc = spawn("podman", containerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdin.end(prompt);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    // Accumulators synthesised from the codex JSONL stream. We build the
    // final ResultEvent ourselves because codex does not emit a Claude-style
    // terminal `{"type":"result", ...}` envelope.
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let turnCount = 0;
    let toolUseCount = 0;
    let lastAgentMessage = "";
    let turnFailed = false;
    let codexErrorMessage: string | undefined;

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;

      // Peek at the raw envelope to capture fields parseCodexStreamLine
      // intentionally drops: `agent_message.text` (final assistant reply)
      // and `error.message` (terminal failure reason).
      let envelope: { type?: unknown; item?: unknown; message?: unknown };
      try {
        envelope = JSON.parse(trimmed) as typeof envelope;
      } catch {
        return;
      }
      if (
        envelope.type === "item.completed" &&
        envelope.item &&
        typeof envelope.item === "object"
      ) {
        const item = envelope.item as { type?: unknown; text?: unknown };
        if (item.type === "agent_message" && typeof item.text === "string") {
          lastAgentMessage = item.text;
        }
      }
      if (envelope.type === "turn.failed") {
        turnFailed = true;
      }
      if (envelope.type === "error" && typeof envelope.message === "string") {
        codexErrorMessage = envelope.message;
      }

      const event = parseCodexStreamLine(line);
      if (!event) return;
      if (event.kind === "turn_summary") {
        totalInputTokens += event.inputTokens ?? 0;
        totalOutputTokens += event.outputTokens ?? 0;
        totalCacheReadTokens += event.cacheReadTokens ?? 0;
        turnCount += 1;
      }
      if (event.kind === "tool_use") {
        toolUseCount += 1;
      }
      if (tracePath) {
        writeTraceEventSync(tracePath, event);
      }
    });
    rl.on("error", () => {
      // non-fatal; raw stdout buffer is still being populated.
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeout);

    proc.on("error", (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const errorOutput = stderr || err.message;
      resolve({
        success: false,
        durationMs,
        output: errorOutput,
        error: errorOutput,
        infraFailure: detectInfraFailure(errorOutput),
        rawTranscript: {
          prompt,
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr,
        },
      });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      const success = !timedOut && code === 0 && !turnFailed && codexErrorMessage === undefined;

      if (tracePath) {
        const finalEvent: TraceEvent = {
          kind: "result",
          isError: !success,
          text: lastAgentMessage,
          durationMs,
          numTurns: toolUseCount,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: totalCacheReadTokens,
        };
        writeTraceEventSync(tracePath, finalEvent);
      }

      if (timedOut) {
        resolve({
          success: false,
          durationMs,
          output: stdout || stderr || "Process timed out",
          error: "Process timed out",
          infraFailure: true,
          rawTranscript: { prompt, stdout, stderr },
        });
        return;
      }

      const usage: SolveUsage = {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: totalCacheReadTokens,
        numTurns: turnCount,
      };

      const errorText = success
        ? undefined
        : (codexErrorMessage ??
          (turnFailed ? "turn.failed" : stderr || stdout || `Exit code ${code}`));

      resolve({
        success,
        durationMs,
        output: lastAgentMessage || stdout,
        ...(errorText ? { error: errorText } : {}),
        infraFailure: !success ? detectInfraFailure(stderr) || detectInfraFailure(stdout) : false,
        rawTranscript: { prompt, stdout, stderr },
        usage,
      });
    });
  });
}

/**
 * Verify codex pre-requisites: the host's `~/.codex/auth.json` exists and is
 * readable. The container only mounts that one file from outside `workDir`,
 * so a missing/unreadable auth.json is the only host-side failure mode worth
 * surfacing before the run starts.
 */
async function checkCodexAuthStatus(): Promise<AuthCheckResult> {
  const authPath = resolveHostCodexAuthPath();
  try {
    fs.accessSync(authPath, fs.constants.R_OK);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error:
        `codex auth file is not readable at ${authPath} (${message}). ` +
        `Run "codex login" once on the host to write it; the file is mounted read-only into the runner container.`,
    };
  }
}

export function createCodexAdapter(): SolveAdapter {
  return {
    run: runCodex,
    checkAuth: checkCodexAuthStatus,
  };
}
