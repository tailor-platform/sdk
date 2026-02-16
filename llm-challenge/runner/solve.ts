import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ProblemMeta } from "../shared/helpers";

function getSdkVersion(): string | undefined {
  try {
    const pkgPath = path.resolve(
      import.meta.dirname,
      "..",
      "..",
      "packages",
      "sdk",
      "package.json",
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

export type SolveResult = {
  success: boolean;
  costUsd: number;
  durationMs: number;
  output: string;
  error?: string;
  infraFailure?: boolean;
};

type ClaudeCodeOutput = {
  result: string;
  is_error: boolean;
  total_cost_usd: number;
  duration_ms: number;
};

const infraFailurePatterns = [
  /Not logged in/i,
  /API key/i,
  /rate limit/i,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /socket hang up/i,
  /authentication.*failed/i,
  /unauthorized/i,
  /403 Forbidden/i,
];

function detectInfraFailure(output: string): boolean {
  return infraFailurePatterns.some((pattern) => pattern.test(output));
}

function listFilesRecursive(dir: string, base: string = dir): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      files.push(...listFilesRecursive(fullPath, base));
    } else {
      files.push(path.relative(base, fullPath));
    }
  }
  return files.sort();
}

function buildPrompt(problemDir: string, meta: ProblemMeta, workDir: string): string {
  const problemMd = fs.readFileSync(path.join(problemDir, "problem.md"), "utf-8");
  const existingFiles = listFilesRecursive(workDir);

  // Detect fix-broken problems: implement files that overlap with scaffold files
  const scaffoldSet = new Set(meta.files.scaffold);
  const overlapping = meta.files.implement.filter((f) => scaffoldSet.has(f));
  const isFixBroken = overlapping.length > 0;

  const sdkVersion = getSdkVersion();
  const versionLine = sdkVersion ? `SDK version: ${sdkVersion}` : "";

  const systemPrompt = isFixBroken
    ? [
        "You are fixing issues in a @tailor-platform/sdk project.",
        versionLine,
        "Fix the issues in the listed files. Read the existing files first, then modify them.",
        'Use the SDK\'s TypeScript API (import from "@tailor-platform/sdk").',
        "You can read the installed SDK package in node_modules/@tailor-platform/sdk/ for API reference.",
        "Do NOT read any files outside of the current working directory.",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        "You are implementing a @tailor-platform/sdk project.",
        versionLine,
        "Create ONLY the files listed in the task. Do NOT modify existing files.",
        'Use the SDK\'s TypeScript API (import from "@tailor-platform/sdk").',
        "You can read the installed SDK package in node_modules/@tailor-platform/sdk/ for API reference.",
        "Do NOT read any files outside of the current working directory.",
      ]
        .filter(Boolean)
        .join("\n");

  const existingFilesList = existingFiles.map((f) => `- ${f}`).join("\n");
  const filesToCreate = meta.files.implement.map((f) => `- ${f}`).join("\n");
  const filesLabel = isFixBroken ? "## Files to Fix" : "## Files to Create";

  const userPrompt = [
    "## Existing Files",
    "",
    "The following files already exist in the project:",
    existingFilesList,
    "",
    "## Task",
    "",
    problemMd,
    "",
    filesLabel,
    "",
    filesToCreate,
  ].join("\n");

  return `${systemPrompt}\n\n${userPrompt}`;
}

function buildRetryPrompt(
  problemDir: string,
  meta: ProblemMeta,
  workDir: string,
  errorOutput: string,
): string {
  const problemMd = fs.readFileSync(path.join(problemDir, "problem.md"), "utf-8");
  const existingFiles = listFilesRecursive(workDir);

  const sdkVersion = getSdkVersion();
  const versionLine = sdkVersion ? `SDK version: ${sdkVersion}` : "";

  const systemPrompt = [
    "You are fixing issues in a @tailor-platform/sdk project.",
    versionLine,
    "Fix the issues in the listed files. Read the existing files first, then modify them.",
    'Use the SDK\'s TypeScript API (import from "@tailor-platform/sdk").',
    "You can read the installed SDK package in node_modules/@tailor-platform/sdk/ for API reference.",
    "Do NOT read any files outside of the current working directory.",
  ]
    .filter(Boolean)
    .join("\n");

  const existingFilesList = existingFiles.map((f) => `- ${f}`).join("\n");
  const filesToFix = meta.files.implement.map((f) => `- ${f}`).join("\n");

  const userPrompt = [
    "## Existing Files",
    "",
    "The following files already exist in the project:",
    existingFilesList,
    "",
    "## Task",
    "",
    problemMd,
    "",
    "## Files to Fix",
    "",
    filesToFix,
    "",
    "## Previous Attempt Error",
    "",
    "Your previous implementation produced the following error. Please fix the issues:",
    "",
    "```",
    truncateErrorOutput(errorOutput),
    "```",
    "",
    "Read the existing files you created previously and fix them to resolve the error.",
  ].join("\n");

  return `${systemPrompt}\n\n${userPrompt}`;
}

function truncateErrorOutput(output: string, maxLength = 5000): string {
  if (output.length <= maxLength) return output;

  // Extract high-priority lines with surrounding context for TS errors
  const lines = output.split("\n");
  const priorityLines: string[] = [];
  const otherLines: string[] = [];
  const contextRadius = 2;

  const priorityIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (/TS\d{4}/.test(lines[i]!) || /FAIL|AssertionError|Expected|Received|✗|×/.test(lines[i]!)) {
      for (
        let j = Math.max(0, i - contextRadius);
        j <= Math.min(lines.length - 1, i + contextRadius);
        j++
      ) {
        priorityIndices.add(j);
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (priorityIndices.has(i)) {
      priorityLines.push(lines[i]!);
    } else {
      otherLines.push(lines[i]!);
    }
  }

  // Build output: priority lines first, then remaining up to limit
  const priorityBlock = priorityLines.join("\n");
  if (priorityBlock.length >= maxLength) {
    return priorityBlock.slice(0, maxLength);
  }

  const remaining = maxLength - priorityBlock.length - 1;
  const otherBlock = otherLines.join("\n").slice(0, remaining);

  return priorityBlock ? `${priorityBlock}\n${otherBlock}` : otherBlock;
}

const claudeSettingsPath = path.join(import.meta.dirname, "claude-settings.json");

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CLAUDE")) {
      delete env[key];
    }
  }
  delete env.OLDPWD;
  return env;
}

export async function retrySolveProblem(options: {
  workDir: string;
  problemDir: string;
  meta: ProblemMeta;
  model: string;
  maxBudget: number;
  errorOutput: string;
}): Promise<SolveResult> {
  const { workDir, problemDir, meta, model, maxBudget, errorOutput } = options;
  const prompt = buildRetryPrompt(problemDir, meta, workDir, errorOutput);
  return runClaude({ prompt, workDir, model, maxBudget });
}

function runClaude(options: {
  prompt: string;
  workDir: string;
  model: string;
  maxBudget: number;
}): Promise<SolveResult> {
  const { prompt, workDir, model, maxBudget } = options;

  const args = [
    "-p",
    prompt,
    "--setting-sources",
    "",
    "--settings",
    claudeSettingsPath,
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "json",
    "--model",
    model,
    "--max-budget-usd",
    String(maxBudget),
    "--tools",
    "Read,Write,Glob,Grep,Bash",
    "--no-session-persistence",
  ];

  const env = cleanEnv();
  const startTime = Date.now();
  const timeout = 300_000; // 5 minutes

  return new Promise<SolveResult>((resolve) => {
    const proc = spawn("claude", args, {
      cwd: workDir,
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

      // Try to parse JSON output (Claude Code outputs JSON with --output-format json)
      try {
        const parsed = JSON.parse(output) as ClaudeCodeOutput;
        const costUsd = parsed.total_cost_usd ?? 0;
        const parsedDuration = parsed.duration_ms ?? durationMs;
        const parsedOutput = parsed.result ?? output;
        const success = code === 0 && !parsed.is_error;
        resolve({
          success,
          costUsd,
          durationMs: parsedDuration,
          output: parsedOutput,
          error: !success ? parsedOutput : undefined,
          infraFailure: !success ? detectInfraFailure(parsedOutput) : false,
        });
      } catch {
        resolve({
          success: false,
          costUsd: 0,
          durationMs,
          output,
          error: output || "Failed to parse Claude Code JSON output",
          infraFailure: detectInfraFailure(output),
        });
      }
    });
  });
}

export async function solveProblem(options: {
  workDir: string;
  problemDir: string;
  meta: ProblemMeta;
  model: string;
  maxBudget: number;
}): Promise<SolveResult> {
  const { workDir, problemDir, meta, model, maxBudget } = options;
  const prompt = buildPrompt(problemDir, meta, workDir);
  return runClaude({ prompt, workDir, model, maxBudget });
}

/**
 * Check if Claude Code can authenticate successfully.
 * Runs a lightweight prompt to verify auth status before starting a full solve run.
 */
export function checkAuthStatus(): Promise<{ ok: boolean; error?: string }> {
  const args = [
    "-p",
    "Reply with exactly: ok",
    "--output-format",
    "json",
    "--max-budget-usd",
    "0.01",
    "--no-session-persistence",
  ];

  const env = cleanEnv();
  const timeout = 30_000;

  return new Promise((resolve) => {
    const proc = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      detached: true,
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

      try {
        const parsed = JSON.parse(stdout || stderr) as ClaudeCodeOutput;
        if (parsed.is_error) {
          resolve({ ok: false, error: parsed.result });
          return;
        }
        resolve({ ok: true });
      } catch {
        const output = stdout || stderr;
        if (infraFailurePatterns.some((p) => p.test(output))) {
          resolve({ ok: false, error: output });
          return;
        }
        // If we got some output and no infra failure detected, assume ok
        resolve({ ok: code === 0 });
      }
    });
  });
}
