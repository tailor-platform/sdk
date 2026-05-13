import fs from "node:fs";
import path from "node:path";
import { getSdkVersion } from "../shared/helpers";
import type { ContextProfile } from "./context-profile";
import { buildContextProfileInstructions } from "./context-profile";
import type { ProblemMeta } from "./cli";
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

/**
 * Derive the `implement` / `scaffold` file lists for Phase 2 micro-problems
 * that omit `meta.files`. Implementation files come from the solution tree;
 * scaffold files are the names that already exist in the work tree before the
 * solver runs. Falls back to empty lists if `solution/` is absent.
 */
function deriveFilesFromSolution(
  problemDir: string,
  workDir: string,
): { implement: string[]; scaffold: string[] } {
  const solutionDir = path.join(problemDir, "solution");
  if (!fs.existsSync(solutionDir)) {
    return { implement: [], scaffold: [] };
  }
  const implement = listFilesRecursive(solutionDir);
  const existing = new Set(listFilesRecursive(workDir));
  const scaffold = implement.filter((f) => existing.has(f));
  return { implement, scaffold };
}

function buildPromptSections(
  problemDir: string,
  meta: ProblemMeta,
  workDir: string,
): {
  problemMd: string;
  existingFilesList: string;
  filesToFix: string[];
  filesToCreate: string[];
  mode: "implement" | "fix" | "hybrid";
} {
  const problemMd = fs.readFileSync(path.join(problemDir, "problem.md"), "utf-8");
  const existingFiles = listFilesRecursive(workDir);
  const files = meta.files ?? deriveFilesFromSolution(problemDir, workDir);
  const scaffoldSet = new Set(files.scaffold);
  const filesToFix = files.implement.filter((f) => scaffoldSet.has(f));
  const filesToCreate = files.implement.filter((f) => !scaffoldSet.has(f));

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
    filesToFix,
    filesToCreate,
    mode,
  };
}

export function buildPrompt(
  problemDir: string,
  meta: ProblemMeta,
  workDir: string,
  contextProfileName: ContextProfile,
): string {
  const { problemMd, existingFilesList, filesToFix, filesToCreate, mode } = buildPromptSections(
    problemDir,
    meta,
    workDir,
  );

  const systemPrompt = buildSystemPrompt(mode);
  const contextProfile = buildContextProfileInstructions(workDir, contextProfileName);

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
    "## SDK Context",
    "",
    contextProfile,
    "",
    "## Task",
    "",
    problemMd,
    "",
    ...filesSection,
  ].join("\n");

  return `${systemPrompt}\n\n${userPrompt}`;
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
  tracePath?: string;
}): Promise<SolveResult> {
  const { agent, ...runOptions } = options;
  return solveAdapters[agent].run(runOptions);
}

export function solveProblem(options: {
  workDir: string;
  problemDir: string;
  meta: ProblemMeta;
  agent: SolveAgent;
  model?: string;
  maxBudget: number;
  contextProfile: ContextProfile;
  /** Optional JSONL path for behaviour trace. */
  tracePath?: string;
}): Promise<SolveResult> {
  const { workDir, problemDir, meta, agent, model, maxBudget, contextProfile, tracePath } = options;
  const prompt = buildPrompt(problemDir, meta, workDir, contextProfile);
  return runSolver({
    agent,
    prompt,
    workDir,
    model,
    maxBudget,
    ...(tracePath !== undefined ? { tracePath } : {}),
  });
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
