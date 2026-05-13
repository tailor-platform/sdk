import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { parseCodexStreamLine } from "../trace";
import { CONTAINER_WORK_DIR, buildContainerRunArgs, ensureImage } from "./container";
import { detectInfraFailure } from "./shared";
import type {
  AuthCheckResult,
  SolveAdapter,
  SolveResult,
  SolveRunOptions,
  SolveUsage,
} from "./types";

type CodexJsonlEvent = {
  type?: unknown;
  item?: unknown;
  message?: unknown;
  error?: unknown;
  usage?: unknown;
};

type CodexUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

// Intentionally approximate pricing to keep budget accounting simple.
const APPROX_INPUT_USD_PER_MILLION = 1.25;
const APPROX_CACHED_INPUT_USD_PER_MILLION = 0.125;
const APPROX_OUTPUT_USD_PER_MILLION = 10;

// Budget enforcement strategy and limitations:
//
// Unlike Claude Code's `--max-cost-dollars`, the Codex CLI has no built-in
// budget or total-cost cap flag. The only per-run lever we have is the
// `model_max_output_tokens` config key, which limits output tokens only.
//
// To approximate total-cost enforcement we:
//   1. Reserve OUTPUT_BUDGET_RATIO (80%) of maxBudget for output tokens and
//      convert that to a `model_max_output_tokens` value. The remaining 20%
//      provides headroom for input-token costs.
//   2. After each run, the caller (cli.ts) tracks cumulative cost via
//      `estimateCodexUsageCostUsd` and subtracts it from the remaining budget
//      before passing to subsequent retries.
//
// Input-token spend within a single run cannot be capped because Codex
// autonomously gathers context (file reads, tool calls) during execution.
// A hard total-cost cap would require Codex CLI support (no such feature
// exists as of 2025-06).
const OUTPUT_BUDGET_RATIO = 0.8;
const MIN_MODEL_MAX_OUTPUT_TOKENS = 32;

type CodexJsonlParseResult = {
  success: boolean;
  message: string;
  error?: string;
  usage?: CodexUsage;
  /**
   * Number of `turn.completed` events in the JSONL stream. Used as the
   * Codex-side `numTurns` proxy when reporting SolveUsage, paralleling Claude
   * Code's `num_turns` JSON field. Counts every completed turn — including
   * intermediate ones whose usage figures are later overwritten — so a
   * single-turn run reports `1`, multi-turn `>= 2`.
   */
  numTurns?: number;
};

type CodexRunStatusInput = {
  code: number | null;
  stdout: string;
  stderr: string;
  output: string;
};

type CodexRunStatus = {
  success: boolean;
  message: string;
  error?: string;
  usage?: CodexUsage;
  numTurns?: number;
  infraFailure: boolean;
};

type CodexAuthStatusInput = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export function estimateCodexUsageCostUsd(usage: CodexUsage | undefined): number {
  if (!usage) {
    return 0;
  }

  const inputTokens = Math.max(0, usage.inputTokens);
  const cachedInputTokens = Math.max(0, Math.min(usage.cachedInputTokens, inputTokens));
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const outputTokens = Math.max(0, usage.outputTokens);

  const costUsd =
    (uncachedInputTokens * APPROX_INPUT_USD_PER_MILLION +
      cachedInputTokens * APPROX_CACHED_INPUT_USD_PER_MILLION +
      outputTokens * APPROX_OUTPUT_USD_PER_MILLION) /
    1_000_000;

  return Number.isFinite(costUsd) ? costUsd : 0;
}

export function parseCodexJsonlOutput(output: string): CodexJsonlParseResult {
  const lines = output.split("\n");
  let latestMessage = "";
  let latestError: string | undefined;
  let sawTurnCompleted = false;
  let sawTurnFailed = false;
  let usage: CodexUsage | undefined;
  let numTurns = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    let parsed: CodexJsonlEvent;
    try {
      parsed = JSON.parse(trimmed) as CodexJsonlEvent;
    } catch {
      continue;
    }
    const eventType = typeof parsed.type === "string" ? parsed.type : "";
    switch (eventType) {
      case "item.completed": {
        const item =
          parsed.item && typeof parsed.item === "object"
            ? (parsed.item as { type?: unknown; text?: unknown })
            : undefined;
        if (item?.type === "agent_message" && typeof item.text === "string") {
          latestMessage = item.text;
        }
        break;
      }
      case "error":
        if (
          typeof parsed.message === "string" &&
          // Keep the concrete turn.failed reason when trailing generic error events follow.
          !(sawTurnFailed && latestError)
        ) {
          latestError = parsed.message;
        }
        break;
      case "turn.failed": {
        sawTurnFailed = true;
        const error =
          parsed.error && typeof parsed.error === "object"
            ? (parsed.error as { message?: unknown })
            : undefined;
        if (typeof error?.message === "string") {
          latestError = error.message;
        }
        break;
      }
      case "turn.completed": {
        sawTurnCompleted = true;
        numTurns += 1;
        if (parsed.usage && typeof parsed.usage === "object") {
          const usageRaw = parsed.usage as {
            input_tokens?: unknown;
            cached_input_tokens?: unknown;
            output_tokens?: unknown;
          };
          usage = {
            inputTokens: typeof usageRaw.input_tokens === "number" ? usageRaw.input_tokens : 0,
            cachedInputTokens:
              typeof usageRaw.cached_input_tokens === "number" ? usageRaw.cached_input_tokens : 0,
            outputTokens: typeof usageRaw.output_tokens === "number" ? usageRaw.output_tokens : 0,
          };
        }
        break;
      }
    }
  }

  const success = sawTurnCompleted && !sawTurnFailed;
  return {
    success,
    message: latestMessage,
    error: success ? undefined : latestError,
    usage,
    ...(numTurns > 0 ? { numTurns } : {}),
  };
}

/**
 * Convert a USD budget into an approximate `model_max_output_tokens` value.
 *
 * This is the only pre-run cost lever available in the Codex CLI (see the
 * budget comment block above for the full enforcement strategy). The
 * returned value is intentionally conservative: only {@link OUTPUT_BUDGET_RATIO}
 * of the budget is allocated to output, leaving headroom for input costs.
 */
export function estimateCodexMaxOutputTokens(maxBudget: number): number {
  const cappedBudgetUsd = Math.max(0, maxBudget * OUTPUT_BUDGET_RATIO);
  const estimatedTokens = Math.floor((cappedBudgetUsd * 1_000_000) / APPROX_OUTPUT_USD_PER_MILLION);
  return Math.max(MIN_MODEL_MAX_OUTPUT_TOKENS, estimatedTokens);
}

export function interpretCodexRunStatus(input: CodexRunStatusInput): CodexRunStatus {
  const { code, stdout, stderr, output } = input;
  const parsed = parseCodexJsonlOutput(stdout);
  const { success } = parsed;
  const error = success
    ? undefined
    : parsed.error || output || (code === null ? "Codex process terminated" : `Exit code ${code}`);
  const errorSignal = [parsed.error, stderr, stdout].filter(Boolean).join("\n");

  return {
    success,
    message: parsed.message || output,
    error,
    usage: parsed.usage,
    ...(parsed.numTurns !== undefined ? { numTurns: parsed.numTurns } : {}),
    infraFailure: success ? false : detectInfraFailure(errorSignal),
  };
}

export function interpretCodexAuthStatus(input: CodexAuthStatusInput): AuthCheckResult {
  const { code, stdout, stderr } = input;
  const parsed = parseCodexJsonlOutput(stdout);
  if (parsed.success) {
    return { ok: true };
  }

  const output = parsed.error || stderr || stdout;
  return {
    ok: false,
    error: output || (code === null ? "Codex process terminated" : `Exit code ${code}`),
  };
}

async function runCodex(options: SolveRunOptions): Promise<SolveResult> {
  await ensureImage();

  const { prompt, workDir, model, maxBudget, tracePath } = options;
  const modelMaxOutputTokens = estimateCodexMaxOutputTokens(maxBudget);
  const cliArgs = [
    "exec",
    "--json",
    // Bypass Codex's bubblewrap sandbox: it cannot create mount namespaces
    // inside a rootless Podman container. The container itself provides
    // filesystem isolation, so the internal sandbox is redundant.
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    CONTAINER_WORK_DIR,
    "--skip-git-repo-check",
    "-c",
    `model_max_output_tokens=${String(modelMaxOutputTokens)}`,
    // Override reasoning effort to prevent config.toml's value (e.g. "xhigh")
    // from conflicting with models that only support low/medium/high.
    "-c",
    "model_reasoning_effort=high",
    ...(model ? ["--model", model] : []),
    "-",
  ];

  const containerArgs = buildContainerRunArgs("codex", cliArgs, { workDir, stdin: true });
  const startTime = Date.now();
  const timeout = 1_200_000; // 20 minutes

  // Initialise the trace file so callers can rely on its presence even when
  // the agent produced zero parseable events.
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

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    // Line-buffered trace writer (mirrors Claude adapter behaviour).
    if (tracePath) {
      const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const event = parseCodexStreamLine(line);
        if (event) {
          try {
            fs.appendFileSync(tracePath, `${JSON.stringify(event)}\n`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`warn: failed to append trace event: ${message}\n`);
          }
        }
      });
      rl.on("error", () => {
        // non-fatal; stdout buffer still receives raw bytes.
      });
    }

    proc.stdin.write(prompt);
    proc.stdin.end();

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

      const interpreted = interpretCodexRunStatus({ code, stdout, stderr, output });
      const estimatedCostUsd = estimateCodexUsageCostUsd(interpreted.usage);
      // Codex's `cached_input_tokens` is its prompt-cache read counter, which
      // aligns with Anthropic's `cache_read_input_tokens` semantics (tokens
      // read from cache, not tokens written into cache). Codex does not
      // surface a separate cache-creation counter, so the cross-adapter
      // `cacheReadTokens` aggregate is read-only for both vendors.
      let solveUsage: SolveUsage | undefined;
      if (interpreted.usage) {
        solveUsage = {
          inputTokens: interpreted.usage.inputTokens,
          outputTokens: interpreted.usage.outputTokens,
          cacheReadTokens: interpreted.usage.cachedInputTokens,
          ...(interpreted.numTurns !== undefined ? { numTurns: interpreted.numTurns } : {}),
        };
      } else if (interpreted.numTurns !== undefined) {
        solveUsage = { numTurns: interpreted.numTurns };
      }

      resolve({
        success: interpreted.success,
        costUsd: estimatedCostUsd,
        durationMs,
        output: interpreted.message,
        error: interpreted.error,
        infraFailure: interpreted.infraFailure,
        rawTranscript: {
          prompt,
          stdout,
          stderr,
        },
        ...(solveUsage ? { usage: solveUsage } : {}),
      });
    });
  });
}

async function checkCodexAuthStatus(model?: string): Promise<AuthCheckResult> {
  await ensureImage();

  const cliArgs = [
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    "/tmp",
    "--skip-git-repo-check",
    "-c",
    "model_reasoning_effort=high",
    ...(model ? ["--model", model] : []),
    "Reply with exactly: ok",
  ];

  const containerArgs = buildContainerRunArgs("codex", cliArgs);
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
      resolve(interpretCodexAuthStatus({ code, stdout, stderr }));
    });
  });
}

export function createCodexAdapter(): SolveAdapter {
  return {
    run: runCodex,
    checkAuth: checkCodexAuthStatus,
  };
}
