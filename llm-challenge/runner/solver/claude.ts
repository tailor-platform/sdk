import { spawn } from "node:child_process";
import { buildContainerRunArgs, ensureImage } from "./container";
import { detectInfraFailure, infraFailurePatterns } from "./shared";
import type { AuthCheckResult, SolveAdapter, SolveResult, SolveRunOptions } from "./types";

type ClaudeCodeOutput = {
  result: string;
  is_error: boolean;
  total_cost_usd: number;
  duration_ms: number;
};

type ClaudeJsonParseResult = {
  parsed: boolean;
  isError: boolean;
  result: string;
  costUsd: number;
  durationMs?: number;
};

type ClaudeAuthStatusInput = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export function parseClaudeJsonOutput(output: string): ClaudeJsonParseResult {
  try {
    const parsed = JSON.parse(output) as ClaudeCodeOutput;
    return {
      parsed: true,
      isError: parsed.is_error,
      result: parsed.result ?? output,
      costUsd: parsed.total_cost_usd ?? 0,
      durationMs: parsed.duration_ms,
    };
  } catch {
    return {
      parsed: false,
      isError: true,
      result: output,
      costUsd: 0,
    };
  }
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

async function runClaude(options: SolveRunOptions): Promise<SolveResult> {
  await ensureImage();

  const { prompt, workDir, model, maxBudget } = options;

  const cliArgs = [
    "-p",
    prompt,
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "json",
    ...(model ? ["--model", model] : []),
    "--max-budget-usd",
    String(maxBudget),
    "--tools",
    "Read,Write,Glob,Grep,Bash",
    "--no-session-persistence",
  ];

  const containerArgs = buildContainerRunArgs("claude", cliArgs, { workDir });
  const startTime = Date.now();
  const timeout = 1_200_000; // 20 minutes

  return new Promise<SolveResult>((resolve) => {
    const proc = spawn("podman", containerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

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

export function createClaudeAdapter(): SolveAdapter {
  return {
    run: runClaude,
    checkAuth: checkClaudeAuthStatus,
  };
}
