import fs from "node:fs";
import path from "node:path";
import { getSdkVersion } from "../shared/helpers";
import type { ProblemMeta } from "../shared/helpers";
import { createClaudeAdapter } from "./solver/claude";
import { createCodexAdapter } from "./solver/codex";
import type { AuthCheckResult, SolveAdapter, SolveAgent, SolveResult } from "./solver/types";

const challengeRoot = path.resolve(import.meta.dirname, "..");

export type { SolveAgent, SolveResult };

function listFilesRecursive(dir: string, base: string = dir): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".sdk") {
        continue;
      }
      files.push(...listFilesRecursive(fullPath, base));
    } else {
      files.push(path.relative(base, fullPath));
    }
  }
  return files.sort();
}

const commonSystemLines = [
  'Use the SDK\'s TypeScript API (import from "@tailor-platform/sdk").',
  "Do NOT read any files outside of the current working directory.",
];

function buildSystemPrompt(mode: "implement" | "fix" | "hybrid"): string {
  const sdkVersion = getSdkVersion(challengeRoot);
  const versionLine = sdkVersion ? `SDK version: ${sdkVersion}` : "";

  const modeLines =
    mode === "fix"
      ? [
          "You are fixing issues in a @tailor-platform/sdk project.",
          versionLine,
          "Fix the issues in the listed files. Read the existing files first, then modify them.",
        ]
      : mode === "hybrid"
        ? [
            "You are implementing a @tailor-platform/sdk project.",
            versionLine,
            "Some files already exist and need to be fixed; other files must be created from scratch.",
            'For "Files to Fix": read and modify existing files.',
            'For "Files to Create": create new files.',
          ]
        : [
            "You are implementing a @tailor-platform/sdk project.",
            versionLine,
            "Create ONLY the files listed in the task. Do NOT modify existing files.",
          ];

  return [...modeLines, ...commonSystemLines].filter(Boolean).join("\n");
}

function buildPromptSections(
  problemDir: string,
  meta: ProblemMeta,
  workDir: string,
): {
  problemMd: string;
  existingFilesList: string;
  filesList: string;
  filesToFix: string[];
  filesToCreate: string[];
  mode: "implement" | "fix" | "hybrid";
} {
  const problemMd = fs.readFileSync(path.join(problemDir, "problem.md"), "utf-8");
  const existingFiles = listFilesRecursive(workDir);
  const scaffoldSet = new Set(meta.files.scaffold);
  const filesToFix = meta.files.implement.filter((f) => scaffoldSet.has(f));
  const filesToCreate = meta.files.implement.filter((f) => !scaffoldSet.has(f));

  let mode: "implement" | "fix" | "hybrid";
  if (filesToCreate.length === 0) {
    mode = "fix";
  } else if (filesToFix.length === 0) {
    mode = "implement";
  } else {
    mode = "hybrid";
  }

  return {
    problemMd,
    existingFilesList: existingFiles.map((f) => `- ${f}`).join("\n"),
    filesList: meta.files.implement.map((f) => `- ${f}`).join("\n"),
    filesToFix,
    filesToCreate,
    mode,
  };
}

function buildPrompt(problemDir: string, meta: ProblemMeta, workDir: string): string {
  const { problemMd, existingFilesList, filesToFix, filesToCreate, mode } = buildPromptSections(
    problemDir,
    meta,
    workDir,
  );

  const systemPrompt = buildSystemPrompt(mode);

  const filesSection =
    mode === "hybrid"
      ? [
          "## Files to Fix",
          "",
          filesToFix.map((f) => `- ${f}`).join("\n"),
          "",
          "## Files to Create",
          "",
          filesToCreate.map((f) => `- ${f}`).join("\n"),
        ]
      : [
          mode === "fix" ? "## Files to Fix" : "## Files to Create",
          "",
          [...filesToFix, ...filesToCreate].map((f) => `- ${f}`).join("\n"),
        ];

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
    ...filesSection,
  ].join("\n");

  return `${systemPrompt}\n\n${userPrompt}`;
}

function buildRetryPrompt(
  problemDir: string,
  meta: ProblemMeta,
  workDir: string,
  errorOutput: string,
): string {
  const { problemMd, existingFilesList, filesList } = buildPromptSections(
    problemDir,
    meta,
    workDir,
  );

  const systemPrompt = buildSystemPrompt("fix");

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
    filesList,
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
    if (/TS\d{4}|FAIL|AssertionError|Expected|Received|✗|×/.test(lines[i]!)) {
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

const solveAdapters: Record<SolveAgent, SolveAdapter> = {
  claude: createClaudeAdapter(),
  codex: createCodexAdapter(),
};

function runSolver(options: {
  agent: SolveAgent;
  prompt: string;
  workDir: string;
  model?: string;
  maxBudget: number;
}): Promise<SolveResult> {
  const { agent, ...runOptions } = options;
  return solveAdapters[agent].run(runOptions);
}

export function retrySolveProblem(options: {
  workDir: string;
  problemDir: string;
  meta: ProblemMeta;
  agent: SolveAgent;
  model?: string;
  maxBudget: number;
  errorOutput: string;
}): Promise<SolveResult> {
  const { workDir, problemDir, meta, agent, model, maxBudget, errorOutput } = options;
  const prompt = buildRetryPrompt(problemDir, meta, workDir, errorOutput);
  return runSolver({ agent, prompt, workDir, model, maxBudget });
}

export function solveProblem(options: {
  workDir: string;
  problemDir: string;
  meta: ProblemMeta;
  agent: SolveAgent;
  model?: string;
  maxBudget: number;
}): Promise<SolveResult> {
  const { workDir, problemDir, meta, agent, model, maxBudget } = options;
  const prompt = buildPrompt(problemDir, meta, workDir);
  return runSolver({ agent, prompt, workDir, model, maxBudget });
}

/**
 * Check if solve agent can authenticate successfully.
 * Runs a lightweight prompt to verify auth status before starting a full solve run.
 */
export function checkAuthStatus(options: {
  agent: SolveAgent;
  model?: string;
}): Promise<AuthCheckResult> {
  return solveAdapters[options.agent].checkAuth(options.model);
}
