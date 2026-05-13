import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { appendTraceEvent, parseClaudeStreamLine } from "../trace";
import type { TraceEvent } from "../trace";
import { buildContainerRunArgs, ensureImage } from "./container";
import { detectInfraFailure, infraFailurePatterns } from "./shared";
import type {
  AuthCheckResult,
  SolveAdapter,
  SolveResult,
  SolveRunOptions,
  SolveUsage,
} from "./types";

type ClaudeUsageJson = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type ClaudeCodeOutput = {
  result: string;
  is_error: boolean;
  total_cost_usd: number;
  duration_ms: number;
  /** Claude Code's --output-format json reports per-turn token usage here. */
  usage?: ClaudeUsageJson;
  /** Number of agent turns (assistant invocations). */
  num_turns?: number;
};

type ClaudeJsonParseResult = {
  parsed: boolean;
  isError: boolean;
  result: string;
  costUsd: number;
  durationMs?: number;
  usage?: SolveUsage;
};

function extractClaudeUsage(parsed: ClaudeCodeOutput): SolveUsage | undefined {
  const raw = parsed.usage;
  const numTurns = parsed.num_turns;
  if (!raw && numTurns === undefined) {
    return undefined;
  }
  const usage: SolveUsage = {};
  if (typeof raw?.input_tokens === "number") {
    usage.inputTokens = raw.input_tokens;
  }
  if (typeof raw?.output_tokens === "number") {
    usage.outputTokens = raw.output_tokens;
  }
  if (typeof raw?.cache_read_input_tokens === "number") {
    usage.cacheReadTokens = raw.cache_read_input_tokens;
  }
  if (typeof numTurns === "number") {
    usage.numTurns = numTurns;
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

type ClaudeAuthStatusInput = {
  code: number | null;
  stdout: string;
  stderr: string;
};

/**
 * Parse a single JSON result envelope (legacy `--output-format json`) OR a
 * concatenated stream-json output by scanning for the final `result` line.
 *
 * Stream-json output contains many newline-delimited JSON objects ending with
 * a single `{"type":"result",...}` envelope. To stay compatible with the
 * legacy single-object format used by `interpretClaudeAuthStatus`, we first
 * try the whole-string JSON.parse and fall back to scanning for the result
 * line when that fails.
 */
export function parseClaudeJsonOutput(output: string): ClaudeJsonParseResult {
  const direct = tryParseDirectResult(output);
  if (direct) return direct;

  const streamed = tryParseStreamResult(output);
  if (streamed) return streamed;

  return {
    parsed: false,
    isError: true,
    result: output,
    costUsd: 0,
  };
}

function tryParseDirectResult(output: string): ClaudeJsonParseResult | undefined {
  try {
    const parsed = JSON.parse(output) as ClaudeCodeOutput;
    if (typeof parsed.is_error !== "boolean") return undefined;
    const usage = extractClaudeUsage(parsed);
    return {
      parsed: true,
      isError: parsed.is_error,
      result: parsed.result ?? output,
      costUsd: parsed.total_cost_usd ?? 0,
      durationMs: parsed.duration_ms,
      ...(usage ? { usage } : {}),
    };
  } catch {
    return undefined;
  }
}

function tryParseStreamResult(output: string): ClaudeJsonParseResult | undefined {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: ClaudeCodeOutput & { type?: string };
    try {
      parsed = JSON.parse(trimmed) as ClaudeCodeOutput & { type?: string };
    } catch {
      continue;
    }
    if (parsed.type !== "result") continue;
    const usage = extractClaudeUsage(parsed);
    return {
      parsed: true,
      isError: parsed.is_error,
      result: parsed.result ?? "",
      costUsd: parsed.total_cost_usd ?? 0,
      durationMs: parsed.duration_ms,
      ...(usage ? { usage } : {}),
    };
  }
  return undefined;
}

export function interpretClaudeAuthStatus(input: ClaudeAuthStatusInput): AuthCheckResult {
  const { code, stdout, stderr } = input;
  const output = stdout || stderr;
  const parsed = parseClaudeJsonOutput(output);
  if (parsed.parsed) {
    if (!parsed.isError) {
      return { ok: true };
    }
    return {
      ok: false,
      error:
        parsed.result ||
        output ||
        (code === null ? "Claude process terminated" : `Exit code ${code}`),
    };
  }

  if (infraFailurePatterns.some((p) => p.test(output))) {
    return { ok: false, error: output };
  }

  return {
    ok: code === 0,
    error:
      code === 0
        ? undefined
        : output || (code === null ? "Claude process terminated" : `Exit code ${code}`),
  };
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

async function runClaude(options: SolveRunOptions): Promise<SolveResult> {
  await ensureImage();

  const { prompt, workDir, model, maxBudget, tracePath } = options;

  // Stream-json requires --verbose and emits one JSON envelope per line.
  const cliArgs = [
    "-p",
    prompt,
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "stream-json",
    "--verbose",
    ...(model ? ["--model", model] : []),
    "--max-budget-usd",
    String(maxBudget),
    "--tools",
    "Read,Write,Glob,Grep,Bash,Edit",
    "--no-session-persistence",
  ];

  const containerArgs = buildContainerRunArgs("claude", cliArgs, { workDir });
  const startTime = Date.now();
  const timeout = 1_200_000; // 20 minutes

  // Initialise the trace file if requested so callers can rely on its
  // presence even when the agent produced zero parseable events.
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
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    // Line-buffered parser: consume stdout incrementally and emit trace events
    // as they arrive. We still keep the raw stdout buffer for backward-compat
    // SolveResult construction (parseClaudeJsonOutput at close time).
    if (tracePath) {
      const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const event = parseClaudeStreamLine(line);
        if (event) {
          writeTraceEventSync(tracePath, event);
        }
      });
      rl.on("error", () => {
        // readline errors are non-fatal; the raw stdout buffer is still being
        // populated by the data handler above.
      });
    }

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
        costUsd: 0,
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
      const output = stdout || stderr;

      // Timeout is always an infrastructure failure
      if (timedOut) {
        resolve({
          success: false,
          costUsd: 0,
          durationMs,
          output: output || "Process timed out",
          error: "Process timed out",
          infraFailure: true,
          rawTranscript: {
            prompt,
            stdout,
            stderr,
          },
        });
        return;
      }

      const parsed = parseClaudeJsonOutput(output);
      if (parsed.parsed) {
        const success = code === 0 && !parsed.isError;
        resolve({
          success,
          costUsd: parsed.costUsd,
          durationMs: parsed.durationMs ?? durationMs,
          output: parsed.result,
          error: !success ? parsed.result : undefined,
          infraFailure: !success
            ? detectInfraFailure(parsed.result) || detectInfraFailure(stderr)
            : false,
          rawTranscript: {
            prompt,
            stdout,
            stderr,
          },
          ...(parsed.usage ? { usage: parsed.usage } : {}),
        });
      } else {
        resolve({
          success: false,
          costUsd: 0,
          durationMs,
          output,
          error: output || "Failed to parse Claude Code JSON output",
          infraFailure: detectInfraFailure(output),
          rawTranscript: {
            prompt,
            stdout,
            stderr,
          },
        });
      }
    });
  });
}

async function checkClaudeAuthStatus(model?: string): Promise<AuthCheckResult> {
  await ensureImage();

  const cliArgs = [
    "-p",
    "Reply with exactly: ok",
    "--output-format",
    "json",
    "--max-budget-usd",
    "0.01",
    "--no-session-persistence",
    ...(model ? ["--model", model] : []),
  ];

  const containerArgs = buildContainerRunArgs("claude", cliArgs);
  const timeout = 30_000;

  return new Promise<AuthCheckResult>((resolve) => {
    const proc = spawn("podman", containerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
    }, timeout);

    proc.on("error", (err) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      resolve({ ok: false, error: stderr || err.message });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      resolve(interpretClaudeAuthStatus({ code, stdout, stderr }));
    });
  });
}

/**
 * Reference to `appendTraceEvent` so the export remains tree-shake-stable for
 * callers (cli.ts) that import it indirectly via this module. Internally we
 * use the sync write helper to keep ordering deterministic during streaming.
 */
export { appendTraceEvent };

export function createClaudeAdapter(): SolveAdapter {
  return {
    run: runClaude,
    checkAuth: checkClaudeAuthStatus,
  };
}
