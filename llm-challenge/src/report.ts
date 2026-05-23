import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChallengeReport, ChallengeRunReport, Problem, SdkProfile } from "./types";

export type RunArtifactPaths = {
  artifactDir: string;
  promptPath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  tracePath: string;
  worktreePath: string;
};

export function buildRunArtifactPaths(
  outputDir: string,
  problem: Pick<Problem, "group" | "id">,
  runIndex: number,
): RunArtifactPaths {
  const artifactDir = path.join(outputDir, problem.group, problem.id, `run-${runIndex}`);
  return {
    artifactDir,
    promptPath: path.join(artifactDir, "prompt.md"),
    solverStdoutPath: path.join(artifactDir, "solver.stdout.log"),
    solverStderrPath: path.join(artifactDir, "solver.stderr.log"),
    tracePath: path.join(artifactDir, "trace.jsonl"),
    worktreePath: path.join(artifactDir, "work"),
  };
}

export function createRunReport(options: {
  packageRoot: string;
  problem: Problem;
  profile: SdkProfile | null;
  runIndex: number;
  paths: RunArtifactPaths;
  solverExitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
}): ChallengeRunReport {
  return {
    problemId: options.problem.id,
    group: options.problem.group,
    profile: options.profile,
    runIndex: options.runIndex,
    artifactDir: reportPath(options.packageRoot, options.paths.artifactDir),
    promptPath: reportPath(options.packageRoot, options.paths.promptPath),
    solverStdoutPath: reportPath(options.packageRoot, options.paths.solverStdoutPath),
    solverStderrPath: reportPath(options.packageRoot, options.paths.solverStderrPath),
    tracePath: reportPath(options.packageRoot, options.paths.tracePath),
    worktreePath: reportPath(options.packageRoot, options.paths.worktreePath),
    solverExitCode: options.solverExitCode,
    durationMs: options.durationMs,
    timedOut: options.timedOut,
  };
}

export async function writeReport(reportPath: string, report: ChallengeReport): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export function reportPath(packageRoot: string, targetPath: string): string {
  return path.relative(packageRoot, targetPath).split(path.sep).join(path.posix.sep);
}
