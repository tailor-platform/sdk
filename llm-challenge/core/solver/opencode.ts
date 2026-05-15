import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { parseOpencodeStreamLine } from "../trace";
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
 * Default Ollama model id passed to opencode via `--model ollama/${MODEL}`.
 * Changed from `qwen3-coder:30b` (the original Phase-1 plan) to `gpt-oss:20b`
 * after the host memory check showed Q4_K_M would swap on this 18 GB Mac —
 * see `.agent/tmp/llm-challenge-oss-plan.md` decision #6 (updated 2026-05-15).
 */
const DEFAULT_OSS_MODEL = "gpt-oss:20b";

const OLLAMA_BASE_URL = "http://host.containers.internal:11434/v1";

/**
 * Write the per-run `opencode.json` config that pins the Ollama provider and
 * carries the iteration's `seed`. opencode probes `config.json` /
 * `opencode.json` / `opencode.jsonc` under `/home/node/.config/opencode/` —
 * the container mount targets the `opencode.json` slot.
 *
 * AI SDK option forwarding for non-standard keys (`temperature`, `seed`) is
 * not yet directly observed at the wire level (see "Open question 7" in the
 * plan doc). Even if forwarding turns out to be a no-op, regenerating this
 * file per iteration is still the right shape because seed must vary per
 * iteration; the cost is bounded by N (default 5).
 */
function writeOpencodeConfig(configPath: string, args: { model: string; seed: number }): void {
  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      ollama: {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama (local)",
        options: {
          baseURL: OLLAMA_BASE_URL,
          temperature: 0.2,
          seed: args.seed,
        },
        models: {
          [args.model]: { name: args.model },
        },
      },
    },
    permission: "allow",
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
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

async function runOpencode(options: SolveRunOptions): Promise<SolveResult> {
  await ensureImage();

  const { prompt, workDir, model, seed = 0, tracePath, maxSeconds } = options;
  const resolvedModel = model || DEFAULT_OSS_MODEL;

  // Per-run tmpdir holds the generated `opencode.json`. `os.tmpdir()` resolves
  // under /var/folders/.../T on macOS, which IS mounted into the podman VM;
  // /tmp (a symlink to /private/tmp) is NOT. The realpath that
  // `mkdtempSync` returns is safe to pass to `podman --volume`.
  const runConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-oss-cfg-"));
  const opencodeConfigPath = path.join(runConfigDir, "opencode.json");
  writeOpencodeConfig(opencodeConfigPath, { model: resolvedModel, seed });

  const cliArgs = [
    "run",
    "--format",
    "json",
    "--dangerously-skip-permissions",
    "--model",
    `ollama/${resolvedModel}`,
    "--dir",
    "/workspace",
    prompt,
  ];

  const containerArgs = buildContainerRunArgs(cliArgs, {
    workDir,
    opencodeConfigPath,
  });
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
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    // Accumulators for the final synthetic ResultEvent / SolveResult.
    // opencode does NOT emit a Claude-style terminal `{"type":"result",
    // "total_cost_usd":...}` envelope, so we build it ourselves from per-step
    // `step_finish` token totals plus the last `text` event's `part.text`.
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let stepCount = 0;
    let lastText = "";

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    if (tracePath) {
      const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const event = parseOpencodeStreamLine(line);
        if (event) {
          if (event.kind === "turn_summary") {
            totalInputTokens += event.inputTokens ?? 0;
            totalOutputTokens += event.outputTokens ?? 0;
            totalCacheReadTokens += event.cacheReadTokens ?? 0;
            stepCount += 1;
          }
          writeTraceEventSync(tracePath, event);
        }
        // Capture the most recent `text` event for the synthetic ResultEvent.
        // The parser intentionally returns null on `text` (no metric value), so
        // we sniff the raw envelope here instead of round-tripping through it.
        try {
          const obj = JSON.parse(line) as { type?: unknown; part?: { text?: unknown } };
          if (obj.type === "text" && obj.part && typeof obj.part.text === "string") {
            lastText = obj.part.text;
          }
        } catch {
          // non-JSON line; ignore
        }
      });
      rl.on("error", () => {
        // non-fatal; raw stdout buffer is still being populated.
      });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeout);

    const cleanup = () => {
      try {
        fs.rmSync(runConfigDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    };

    proc.on("error", (err) => {
      clearTimeout(timer);
      cleanup();
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

      if (tracePath) {
        const finalEvent: TraceEvent = {
          kind: "result",
          isError: timedOut || code !== 0,
          text: lastText,
          durationMs,
          numTurns: stepCount,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: totalCacheReadTokens,
        };
        writeTraceEventSync(tracePath, finalEvent);
      }

      cleanup();

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
        numTurns: stepCount,
      };
      const success = code === 0;
      const errorText = success ? undefined : stderr || stdout || `Exit code ${code}`;

      resolve({
        success,
        durationMs,
        output: lastText || stdout,
        ...(errorText ? { error: errorText } : {}),
        infraFailure: !success ? detectInfraFailure(stderr) || detectInfraFailure(stdout) : false,
        rawTranscript: { prompt, stdout, stderr },
        usage,
      });
    });
  });
}

/**
 * The OSS path has no credentials to check; instead we verify the host's
 * Ollama daemon is reachable on the well-known port. The challenge runner
 * itself runs on the host (outside the container), so `localhost:11434` is
 * the correct address here — the container-internal hostname is
 * `host.containers.internal` and is irrelevant for this readiness check.
 */
async function checkOpencodeAuthStatus(_model?: string): Promise<AuthCheckResult> {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) {
      return { ok: false, error: `Ollama returned HTTP ${res.status} from /api/tags` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error:
        `Ollama is not reachable on http://localhost:11434 (${message}). ` +
        `Start it with: OLLAMA_NUM_PARALLEL=1 OLLAMA_CONTEXT_LENGTH=32768 ollama serve`,
    };
  }
}

export function createOpencodeAdapter(): SolveAdapter {
  return {
    run: runOpencode,
    checkAuth: checkOpencodeAuthStatus,
  };
}
