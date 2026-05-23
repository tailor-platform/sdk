import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRunCommand } from "./args";
import { discoverProblems, selectProblems } from "./problems";
import { createRunReport, reportPath, writeReport } from "./report";
import { runCodexInPodman } from "./runner";
import { packSdk } from "./sdk-pack";
import { prepareWorkspace, profileForProblem } from "./workspace";
import type { ChallengeReport, Problem } from "./types";

type RunTask = {
  problem: Problem;
  runIndex: number;
};

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseRunCommand(argv);
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(packageRoot, "..");
  const problems = selectProblems(
    await discoverProblems(packageRoot),
    options.group,
    options.problemFilters,
  );
  if (problems.length === 0) {
    throw new Error("No problems selected");
  }

  const runId = createRunId();
  const outputDir = path.resolve(packageRoot, options.output ?? path.join("results", runId));
  await fs.mkdir(outputDir, { recursive: true });

  const needsNoDocs = problems.some(
    (problem) => problem.group === "sdk-api" && options.profile === "no-docs",
  );
  console.log(`Packing SDK ${options.sdkRef}`);
  const packedSdk = await packSdk({
    repoRoot,
    sdkRef: options.sdkRef,
    needNoDocs: needsNoDocs,
  });
  console.log(`SDK ${packedSdk.sdkRef.slice(0, 12)} packaged`);

  const report: ChallengeReport = {
    schemaVersion: 1,
    runId,
    timestamp: new Date().toISOString(),
    sdkRef: packedSdk.sdkRef,
    sdkVersion: packedSdk.sdkVersion,
    requestedProfile: options.profile,
    model: options.model,
    effort: options.effort,
    runsPerProblem: options.runs,
    problems: problems.map((problem) => ({
      id: problem.id,
      title: problem.title,
      group: problem.group,
      sourcePath: problem.sourcePath,
    })),
    runs: [],
  };
  const reportFilePath = path.join(outputDir, "report.json");
  await writeReport(reportFilePath, report);

  const tasks = problems.flatMap((problem) =>
    Array.from({ length: options.runs }, (_, runIndex) => ({
      problem,
      runIndex,
    })),
  );

  printHeader();
  try {
    await runWithConcurrency(tasks, options.concurrency, async (task) => {
      const profile = profileForProblem(task.problem, options.profile);
      const sdkTarballPath =
        profile === "no-docs"
          ? requiredNoDocsTarball(packedSdk.noDocsTarballPath)
          : packedSdk.fullTarballPath;
      const paths = await prepareWorkspace({
        outputDir,
        problem: task.problem,
        runIndex: task.runIndex,
        sdkTarballPath,
      });
      const result = await runCodexInPodman({
        worktreePath: paths.worktreePath,
        promptPath: paths.promptPath,
        solverStdoutPath: paths.solverStdoutPath,
        solverStderrPath: paths.solverStderrPath,
        tracePath: paths.tracePath,
        model: options.model,
        effort: options.effort,
        maxSeconds: options.maxSeconds,
      });
      const runReport = createRunReport({
        packageRoot,
        problem: task.problem,
        profile,
        runIndex: task.runIndex,
        paths,
        solverExitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
      });
      report.runs.push(runReport);
      await writeReport(reportFilePath, report);
      printRun(task, reportPath(packageRoot, paths.artifactDir), result);
    });
    // Concurrent run writes can complete out of order; finish with the complete in-memory report.
    await writeReport(reportFilePath, report);
  } finally {
    await packedSdk.cleanup();
  }

  console.log(`Report ${reportPath(packageRoot, reportFilePath)}`);
}

function createRunId(): string {
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let firstError: unknown;
  async function loop(): Promise<void> {
    while (nextIndex < items.length) {
      if (firstError !== undefined) {
        return;
      }
      const item = items[nextIndex];
      nextIndex += 1;
      try {
        await worker(item);
      } catch (error) {
        firstError ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => loop()));
  if (firstError !== undefined) {
    throw firstError;
  }
}

function requiredNoDocsTarball(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("no-docs SDK package was not created");
  }
  return value;
}

function printHeader(): void {
  console.log(`${"Problem".padEnd(36)} ${"Run".padEnd(5)} ${"Artifact".padEnd(58)} Solver`);
}

function printRun(
  task: RunTask,
  artifactDir: string,
  result: { exitCode?: number; timedOut: boolean },
): void {
  const problemName = `${task.problem.group}/${task.problem.id}`;
  const solver = result.timedOut ? "timeout" : `exit=${result.exitCode ?? "unknown"}`;
  console.log(
    `${problemName.padEnd(36)} ${String(task.runIndex).padEnd(5)} ${artifactDir.padEnd(58)} ${solver}`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
