import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ProblemMeta } from "../shared/helpers";

export type SolveResult = {
  success: boolean;
  costUsd: number;
  durationMs: number;
  output: string;
  error?: string;
};

type ClaudeCodeOutput = {
  result: string;
  is_error: boolean;
  total_cost_usd: number;
  duration_ms: number;
};

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

  const systemPrompt = [
    "You are implementing a @tailor-platform/sdk project.",
    "Create ONLY the files listed in the task. Do NOT modify existing files.",
    'Use the SDK\'s TypeScript API (import from "@tailor-platform/sdk").',
    "You can read the installed SDK package in node_modules/@tailor-platform/sdk/ for API reference.",
    "Do NOT read any files outside of the current working directory.",
  ].join("\n");

  const existingFilesList = existingFiles.map((f) => `- ${f}`).join("\n");
  const filesToCreate = meta.files.implement.map((f) => `- ${f}`).join("\n");

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
    "## Files to Create",
    "",
    filesToCreate,
  ].join("\n");

  return `${systemPrompt}\n\n${userPrompt}`;
}

export function solveProblem(options: {
  workDir: string;
  problemDir: string;
  meta: ProblemMeta;
  model: string;
  maxBudget: number;
}): SolveResult {
  const { workDir, problemDir, meta, model, maxBudget } = options;
  const prompt = buildPrompt(problemDir, meta, workDir);

  const args = [
    "claude",
    "-p",
    JSON.stringify(prompt),
    "--setting-sources",
    '""',
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

  const command = args.join(" ");

  // Remove CLAUDECODE env var to prevent nested Claude Code issues
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const startTime = Date.now();
  try {
    const stdout = execSync(command, {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 300_000, // 5 minutes
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    const durationMs = Date.now() - startTime;

    let parsed: ClaudeCodeOutput;
    try {
      parsed = JSON.parse(stdout) as ClaudeCodeOutput;
    } catch {
      return {
        success: false,
        costUsd: 0,
        durationMs,
        output: stdout,
        error: "Failed to parse Claude Code JSON output",
      };
    }

    return {
      success: !parsed.is_error,
      costUsd: parsed.total_cost_usd ?? 0,
      durationMs: parsed.duration_ms ?? durationMs,
      output: parsed.result,
      error: parsed.is_error ? parsed.result : undefined,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const error = err as { stdout?: string; stderr?: string; message: string };
    const output = error.stdout || error.stderr || error.message;

    // Try to parse JSON even from failed execution (Claude Code may exit non-zero with valid JSON)
    try {
      const parsed = JSON.parse(output) as ClaudeCodeOutput;
      return {
        success: false,
        costUsd: parsed.total_cost_usd ?? 0,
        durationMs: parsed.duration_ms ?? durationMs,
        output: parsed.result ?? output,
        error: parsed.result ?? output,
      };
    } catch {
      return {
        success: false,
        costUsd: 0,
        durationMs,
        output,
        error: output,
      };
    }
  }
}
