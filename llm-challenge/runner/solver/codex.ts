import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanEnv, detectInfraFailure } from "./shared";
import type { AuthCheckResult, SolveAdapter, SolveResult, SolveRunOptions } from "./types";

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
//   2. After each run, the caller (run.ts) tracks cumulative cost via
//      `estimateCodexUsageCostUsd` and subtracts it from the remaining budget
//      before passing to subsequent retries.
//
// Input-token spend within a single run cannot be capped because Codex
// autonomously gathers context (file reads, tool calls) during execution.
// A hard total-cost cap would require Codex CLI support (no such feature
// exists as of 2025-06).
const OUTPUT_BUDGET_RATIO = 0.8;
const MIN_MODEL_MAX_OUTPUT_TOKENS = 32;

const codexDenylistRuleJustification = "Benchmark artifact access is forbidden.";
const codexDenylistRuleFile = path.join(".codex", "rules", "llm-challenge-denylist.rules");

// Broad file-discovery commands to block (prevents locating challenge root).
// Includes the current user's home directory so that `find /Users/<username>`
// is blocked (it would otherwise bypass the `find /Users` rule since
// prefix_rule requires exact token match). Deeper subpaths like
// `find $HOME/ghq` are NOT blocked — blocking `find` entirely would prevent
// the model from using `find` within its workspace. This is an accepted
// limitation; the primary defense is path obfuscation (tarball + env scrub).
//
// Note: `find -L /` has tokens ["find", "-L", "/"], which bypasses
// ["find", "/"] since the second token differs. We add common leading
// options (-L, -H, -P) to cover these variants.
const homeDir = os.homedir().replaceAll(path.sep, "/");
// Common absolute paths for discovery commands on macOS/Linux.
// Models can bypass bare command rules (e.g. ["find", "/"]) by using
// absolute paths (e.g. ["/usr/bin/find", "/"]). We duplicate rules for
// the most common binary locations.
const findPaths = ["find", "/usr/bin/find", "/bin/find"];
const fdPaths = ["fd", "/usr/bin/fd", "/usr/local/bin/fd", "/opt/homebrew/bin/fd"];
const locatePaths = ["locate", "/usr/bin/locate"];
const mdfindPaths = ["mdfind", "/usr/bin/mdfind"];

const broadScanTargets = ["/", "/Users", "/home", "/tmp", "/var", "/private", homeDir];
const findLeadingOptions = ["-L", "-H", "-P"];

const discoveryCommandPrefixes: string[][] = [
  // find and absolute-path variants
  ...findPaths.flatMap((cmd) => [
    ...broadScanTargets.map((target) => [cmd, target]),
    ...findLeadingOptions.map((opt) => [cmd, opt]),
  ]),
  // fd and absolute-path variants
  ...fdPaths.flatMap((cmd) => [
    [cmd, "/"],
    [cmd, "/Users"],
    [cmd, "/home"],
    [cmd, "/tmp"],
    [cmd, "--base-directory", "/"],
    [cmd, "--hidden"],
    [cmd, "--no-ignore"],
  ]),
  // locate and mdfind (no arguments needed — bare command is enough)
  ...locatePaths.map((cmd) => [cmd]),
  ...mdfindPaths.map((cmd) => [cmd]),
];

type CodexJsonlParseResult = {
  success: boolean;
  message: string;
  error?: string;
  usage?: CodexUsage;
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

/**
 * Build a minimal denylist ruleset that blocks broad file-discovery commands.
 *
 * This replaces the previous approach of exhaustively enumerating every
 * possible read command for every sensitive file path (~500+ rules).
 * The primary defense is now path-leak prevention (tarball install, env scrub,
 * tmpdir obfuscation) so these rules are a secondary safety net.
 *
 * Why a denylist instead of OS-level isolation (containers/chroot):
 * Codex's `workspace-write` sandbox already restricts writes to the
 * workspace directory. Read access outside the workspace is allowed by
 * design (the model needs to read system libraries, toolchains, etc.).
 * Full OS-level path isolation would require running inside a container
 * or mount namespace, which is a significant infrastructure change
 * beyond the scope of the Codex CLI's sandbox model. The denylist
 * targets the specific reconnaissance commands (find/fd/locate/mdfind)
 * that could scan the filesystem broadly enough to discover the
 * obfuscated challenge root. Relative-path traversal (`find ../../`)
 * and interpreter-based exploration (`python -c "os.walk(...)"`) are
 * not blocked, but they require the model to already know or guess
 * a path prefix, which the obfuscation layer is designed to prevent.
 *
 * IMPORTANT: The rules file must NOT embed the challenge root absolute path.
 * Codex can read `.codex/rules/` files in its workspace, so including the
 * path would leak the primary secret and undermine the obfuscation defense.
 *
 * Why we do NOT add explicit shell-wrapper rules:
 * Codex's execpolicy engine has built-in shell script parsing that
 * automatically splits `/bin/zsh -lc 'find /'` (and bash/sh variants with
 * -c or -lc) into individual commands and applies prefix_rule matching to
 * each one separately. This means our `["find", "/"]` rule already blocks
 * `find /` even when invoked through a shell wrapper. Adding manual
 * wrapper-token patterns (e.g. `["/bin/zsh", "-lc", ...]`) would be
 * redundant and overly broad (blocking all shell-invoked commands).
 * See: https://developers.openai.com/codex/exec-policy
 */
export function buildCodexDenylistRules(): string {
  const justification = JSON.stringify(codexDenylistRuleJustification);
  const lines: string[] = [
    "# Auto-generated by llm-challenge codex runner.",
    "# Blocks broad file-discovery commands to prevent locating benchmark artifacts.",
  ];

  // Block discovery commands that scan filesystem broadly.
  // Shell-wrapped invocations (e.g. `/bin/zsh -lc 'find /'`) are handled
  // automatically by execpolicy's built-in shell script parsing.
  for (const prefix of discoveryCommandPrefixes) {
    const pattern = prefix.map((token) => JSON.stringify(token)).join(", ");
    lines.push(
      `prefix_rule(pattern = [${pattern}], decision = "forbidden", justification = ${justification})`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Ensure that `target` is a real directory (not a symlink, file, or other
 * non-directory node). If the path exists but is not a directory, it is
 * removed and recreated.
 *
 * This prevents the runner from following symlinks or writing into
 * non-directory nodes that a previous Codex run may have planted.
 */
function ensureRealDirectory(target: string): void {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
      return;
    }
    // Remove non-directory node (symlink, file, etc.)
    fs.rmSync(target, { recursive: true });
  } catch {
    // Path does not exist — will be created below.
  }
  fs.mkdirSync(target, { recursive: true });
}

export function ensureCodexDenylistRules(workDir: string): void {
  const resolvedWorkDir = path.resolve(workDir);
  const rulesPath = path.join(resolvedWorkDir, codexDenylistRuleFile);

  // Always regenerate: a previous Codex attempt may have tampered with
  // or removed the rules file, so retries must enforce fresh constraints.
  //
  // Guard against link attacks: Codex (workspace-write) can replace
  // directories or files with symlinks, hard links, or regular files
  // pointing outside the workspace. If we blindly write to them, the
  // runner would overwrite arbitrary external files on retry.
  //
  // For directories: ensure they are real directories (not symlinks/files).
  // For the rules file: write to a temp file and atomically rename to
  // avoid TOCTOU races (a concurrent process planting a symlink between
  // unlink and write).
  const codexDir = path.join(resolvedWorkDir, ".codex");
  const rulesDir = path.join(codexDir, "rules");

  ensureRealDirectory(codexDir);
  ensureRealDirectory(rulesDir);

  // Write rules to a temp file in the same directory, then atomically
  // rename to the target path. renameSync on the same filesystem is
  // atomic and replaces the target entry itself (not following symlinks
  // or hard links), eliminating both TOCTOU races and link attacks.
  //
  // The temp file name is randomized (UUID) to prevent a previous Codex
  // run from planting a symlink/hard link at a predictable path. O_EXCL
  // ensures the open fails if a file already exists at the chosen name.
  const tmpPath = path.join(rulesDir, `.rules-${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(
    tmpPath,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
  );
  try {
    fs.writeSync(fd, buildCodexDenylistRules(), null, "utf-8");
  } finally {
    fs.closeSync(fd);
  }
  // Guard against rulesPath being replaced with a directory (or symlink to a
  // directory) by a prior Codex run. renameSync fails with EISDIR/ENOTEMPTY
  // when the target is a directory, so remove non-file nodes first.
  try {
    const stat = fs.lstatSync(rulesPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fs.rmSync(rulesPath, { recursive: true });
    }
  } catch {
    // Path does not exist — rename will create it.
  }
  try {
    fs.renameSync(tmpPath, rulesPath);
  } catch (err) {
    // Clean up the temp file to avoid leaking it on rename failure.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup.
    }
    throw err;
  }
}

function runCodex(options: SolveRunOptions): Promise<SolveResult> {
  const { prompt, workDir, model, maxBudget } = options;
  ensureCodexDenylistRules(workDir);
  const modelMaxOutputTokens = estimateCodexMaxOutputTokens(maxBudget);
  const args = [
    "exec",
    "--json",
    "--full-auto",
    "--sandbox",
    "workspace-write",
    "--cd",
    workDir,
    "--skip-git-repo-check",
    "-c",
    `model_max_output_tokens=${String(modelMaxOutputTokens)}`,
    ...(model ? ["--model", model] : []),
    "-",
  ];

  const env = cleanEnv();
  const startTime = Date.now();
  const timeout = 600_000; // 10 minutes

  return new Promise<SolveResult>((resolve) => {
    const proc = spawn("codex", args, {
      cwd: workDir,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

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
        });
        return;
      }

      const interpreted = interpretCodexRunStatus({ code, stdout, stderr, output });
      const estimatedCostUsd = estimateCodexUsageCostUsd(interpreted.usage);

      resolve({
        success: interpreted.success,
        costUsd: estimatedCostUsd,
        durationMs,
        output: interpreted.message,
        error: interpreted.error,
        infraFailure: interpreted.infraFailure,
      });
    });
  });
}

function checkCodexAuthStatus(model?: string): Promise<AuthCheckResult> {
  // Run auth check in an empty temp directory to prevent the model from
  // reading repository files during the lightweight "Reply ok" prompt.
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-"));

  const args = [
    "exec",
    "--json",
    "--full-auto",
    "--sandbox",
    "read-only",
    "--cd",
    authDir,
    "--skip-git-repo-check",
    ...(model ? ["--model", model] : []),
    "Reply with exactly: ok",
  ];

  const env = cleanEnv();
  const timeout = 30_000;

  return new Promise<AuthCheckResult>((resolve) => {
    const proc = spawn("codex", args, {
      cwd: authDir,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
    }, timeout);

    const cleanup = () => {
      fs.rmSync(authDir, { recursive: true, force: true });
    };

    proc.on("error", (err) => {
      clearTimeout(timer);
      cleanup();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      resolve({ ok: false, error: stderr || err.message });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      cleanup();
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
