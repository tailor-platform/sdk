import fs from "node:fs";
import path from "node:path";
import { getSdkVersion } from "../shared/helpers";
import type { ProblemMeta } from "../shared/helpers";

const challengeRoot = path.resolve(import.meta.dirname, "..");

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
    filesToFix,
    filesToCreate,
    mode,
  };
}

export function buildPrompt(problemDir: string, meta: ProblemMeta, workDir: string): string {
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
