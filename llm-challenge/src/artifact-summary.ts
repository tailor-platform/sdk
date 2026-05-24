import { promises as fs } from "node:fs";
import path from "node:path";
import { runCommand } from "./process";
import type { Problem, SolverFailureKind } from "./types";

export type ArtifactSummary = {
  schemaVersion: 1;
  generatedAt: string;
  problemId: string;
  group: Problem["group"];
  runIndex: number;
  solverExitCode?: number;
  timedOut?: boolean;
  failureKind: SolverFailureKind;
  files: string[];
  gitStatus: string[];
  commands: Array<{
    command: string;
    exitCode?: number;
    status?: string;
  }>;
  failedCommands: Array<{
    command: string;
    exitCode?: number;
    status?: string;
    outputTail?: string;
  }>;
  errors: string[];
};

const EXCLUDED_DIRS = new Set([
  ".challenge",
  ".git",
  ".pnpm-store",
  ".cache",
  ".turbo",
  "node_modules",
]);
const EXCLUDED_PATHS = new Set([".tailor-sdk/cache"]);

export async function writeArtifactSummary(options: {
  problem: Problem;
  runIndex: number;
  worktreePath: string;
  tracePath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  artifactSummaryPath: string;
  solverExitCode?: number;
  timedOut?: boolean;
  failureKind: SolverFailureKind;
}): Promise<void> {
  const traceEvents = await readTraceEvents(options.tracePath);
  const commands = extractCommands(traceEvents);
  const failedCommands = extractFailedCommands(traceEvents);
  const errors = extractErrors(traceEvents);
  const summary: ArtifactSummary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    problemId: options.problem.id,
    group: options.problem.group,
    runIndex: options.runIndex,
    solverExitCode: options.solverExitCode,
    timedOut: options.timedOut,
    failureKind: options.failureKind,
    files: await listWorkspaceFiles(options.worktreePath),
    gitStatus: await readGitStatus(options.worktreePath),
    commands,
    failedCommands,
    errors,
  };
  await fs.writeFile(options.artifactSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

export async function classifySolverFailure(options: {
  timedOut: boolean;
  solverExitCode?: number;
  tracePath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
}): Promise<SolverFailureKind> {
  if (options.timedOut) {
    return "timeout";
  }
  if (options.solverExitCode === 0) {
    return "none";
  }

  const text = await readAvailableText([
    options.tracePath,
    options.solverStdoutPath,
    options.solverStderrPath,
  ]);
  if (/usage limit|try again at|request to your admin/i.test(text)) {
    return "usage-limit";
  }
  if (
    /cannot execute binary file|codex CLI is not installed|Cannot connect to Podman|unable to connect to Podman|auth\.json|npm is unavailable/i.test(
      text,
    )
  ) {
    return "runner-startup";
  }
  if (options.solverExitCode !== undefined) {
    return "solver-nonzero";
  }
  return "unknown";
}

async function listWorkspaceFiles(worktreePath: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosix(path.relative(worktreePath, absolutePath));
      if (entry.isDirectory()) {
        if (shouldExcludeDirectory(relativePath, entry.name)) {
          continue;
        }
        await walk(absolutePath);
      } else {
        files.push(relativePath);
      }
    }
  }
  await walk(worktreePath);
  return files.sort();
}

function shouldExcludeDirectory(relativePath: string, name: string): boolean {
  return EXCLUDED_DIRS.has(name) || EXCLUDED_PATHS.has(relativePath);
}

async function readGitStatus(worktreePath: string): Promise<string[]> {
  try {
    const result = await runCommand("git", ["status", "--short", "--untracked-files=all"], {
      cwd: worktreePath,
    });
    return result.stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

async function readTraceEvents(tracePath: string): Promise<unknown[]> {
  try {
    const text = await fs.readFile(tracePath, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function extractCommands(events: unknown[]): ArtifactSummary["commands"] {
  return events.flatMap((event) => {
    const item = getItem(event);
    if (item?.type !== "command_execution" || typeof item.command !== "string") {
      return [];
    }
    return [
      {
        command: item.command,
        exitCode: typeof item.exit_code === "number" ? item.exit_code : undefined,
        status: typeof item.status === "string" ? item.status : undefined,
      },
    ];
  });
}

function extractFailedCommands(events: unknown[]): ArtifactSummary["failedCommands"] {
  return events.flatMap((event) => {
    const item = getItem(event);
    if (item?.type !== "command_execution" || typeof item.command !== "string") {
      return [];
    }
    const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
    const status = typeof item.status === "string" ? item.status : undefined;
    if (status !== "failed" && (exitCode === undefined || exitCode === 0)) {
      return [];
    }
    return [
      {
        command: item.command,
        exitCode,
        status,
        outputTail:
          typeof item.aggregated_output === "string" ? tailText(item.aggregated_output) : undefined,
      },
    ];
  });
}

function extractErrors(events: unknown[]): string[] {
  return events.flatMap((event) => {
    if (!isObject(event)) {
      return [];
    }
    if (event.type === "error" && typeof event.message === "string") {
      return [event.message];
    }
    if (isObject(event.error) && typeof event.error.message === "string") {
      return [event.error.message];
    }
    return [];
  });
}

function getItem(event: unknown): Record<string, unknown> | undefined {
  if (!isObject(event) || !isObject(event.item)) {
    return undefined;
  }
  return event.item;
}

async function readAvailableText(filePaths: string[]): Promise<string> {
  const chunks = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        return await fs.readFile(filePath, "utf8");
      } catch {
        return "";
      }
    }),
  );
  return chunks.join("\n");
}

function tailText(value: string): string {
  return value.length <= 1_000 ? value : value.slice(-1_000);
}

function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
