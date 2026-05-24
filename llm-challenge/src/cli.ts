import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRunCommand } from "./args";
import { classifySolverFailure, writeArtifactSummary } from "./artifact-summary";
import { discoverProblems, selectProblems } from "./problems";
import { createRunReport, reportPath, writeReport } from "./report";
import { getCodexRuntimeConfig, preflightCodexRunner, runCodexInPodman } from "./runner";
import { packSdk } from "./sdk-pack";
import { prepareWorkspace, profileForProblem, pruneWorkspaceDeps } from "./workspace";
import type { ChallengeReport, ChallengeRunReport, Problem, ProblemGroup } from "./types";

type RunTask = {
  problem: Problem;
  runIndex: number;
  replaces?: ChallengeRunReport["replaces"];
};

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseRunCommand(argv);
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(packageRoot, "..");
  const allProblems = await discoverProblems(packageRoot);
  const selectedProblems = selectProblems(allProblems, options.group, options.problemFilters);
  const rerunPlan =
    options.rerunNonzeroFrom === undefined
      ? undefined
      : await createRerunPlan({
          packageRoot,
          reportFilePath: options.rerunNonzeroFrom,
          allProblems,
          selectedProblems,
        });
  const problems = rerunPlan?.problems ?? selectedProblems;
  if (problems.length === 0) {
    throw new Error("No problems selected");
  }

  const runId = createRunId();
  const outputDir = path.resolve(packageRoot, options.output ?? path.join("results", runId));
  await fs.mkdir(outputDir, { recursive: true });

  const runtime = getCodexRuntimeConfig();
  console.log(`Preflight ${runtime.image}`);
  const preflight = options.preflight
    ? await preflightCodexRunner(runtime)
    : { skipped: true as const };
  if (!preflight.skipped && preflight.exitCode !== 0) {
    throw new Error(
      `Codex runner preflight failed with exit=${preflight.exitCode ?? "unknown"}${
        preflight.stderr ? `\n${preflight.stderr.trim()}` : ""
      }`,
    );
  }
  console.log(
    preflight.skipped
      ? "Preflight skipped"
      : `Preflight ok${preflight.codexVersion ? ` (${preflight.codexVersion})` : ""}`,
  );

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
    runsPerProblem: rerunPlan?.sourceReport.runsPerProblem ?? options.runs,
    runner: {
      image: runtime.image,
      codexPackage: runtime.codexPackage,
      codexVersion: preflight.skipped ? undefined : preflight.codexVersion,
      preflight: {
        skipped: preflight.skipped,
        exitCode: preflight.skipped ? undefined : (preflight.exitCode ?? undefined),
        durationMs: preflight.skipped ? undefined : preflight.durationMs,
        stderr: preflight.skipped ? undefined : trimReportText(preflight.stderr),
      },
    },
    rerunOf: rerunPlan?.reportRerunOf,
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

  const tasks: RunTask[] =
    rerunPlan?.tasks ??
    problems.flatMap((problem) =>
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
        runtime,
      });
      const failureKind = await classifySolverFailure({
        timedOut: result.timedOut,
        solverExitCode: result.exitCode,
        tracePath: paths.tracePath,
        solverStdoutPath: paths.solverStdoutPath,
        solverStderrPath: paths.solverStderrPath,
      });
      await writeArtifactSummary({
        problem: task.problem,
        runIndex: task.runIndex,
        worktreePath: paths.worktreePath,
        tracePath: paths.tracePath,
        solverStdoutPath: paths.solverStdoutPath,
        solverStderrPath: paths.solverStderrPath,
        artifactSummaryPath: paths.artifactSummaryPath,
        solverExitCode: result.exitCode,
        timedOut: result.timedOut,
        failureKind,
      });
      if (options.pruneWorkspaceDeps) {
        await pruneWorkspaceDeps(paths.worktreePath);
      }
      const runReport = createRunReport({
        packageRoot,
        problem: task.problem,
        profile,
        runIndex: task.runIndex,
        paths,
        solverExitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        failureKind,
        replaces: task.replaces,
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

type SourceRun = {
  problemId: string;
  group: ProblemGroup;
  runIndex: number;
  artifactDir?: string;
  solverExitCode?: number;
  timedOut?: boolean;
};

async function createRerunPlan(options: {
  packageRoot: string;
  reportFilePath: string;
  allProblems: Problem[];
  selectedProblems: Problem[];
}): Promise<{
  sourceReport: ChallengeReport;
  problems: Problem[];
  tasks: RunTask[];
  reportRerunOf: NonNullable<ChallengeReport["rerunOf"]>;
}> {
  const sourceReportPath = await resolveExistingReportPath(
    options.packageRoot,
    options.reportFilePath,
  );
  const sourceReport = JSON.parse(await fs.readFile(sourceReportPath, "utf8")) as ChallengeReport;
  const selectedKeys = new Set(
    options.selectedProblems.map((problem) => `${problem.group}/${problem.id}`),
  );
  const problemByKey = new Map(
    options.allProblems.map((problem) => [`${problem.group}/${problem.id}`, problem]),
  );
  const failedRuns = sourceReport.runs
    .filter((run) => run.timedOut || run.solverExitCode !== 0)
    .filter((run) => selectedKeys.has(`${run.group}/${run.problemId}`));

  if (failedRuns.length === 0) {
    throw new Error(`No nonzero or timed-out runs found in ${options.reportFilePath}`);
  }

  const sourceReportRelativePath = reportPath(options.packageRoot, sourceReportPath);
  const tasks: RunTask[] = failedRuns.map((run) => {
    const key = `${run.group}/${run.problemId}`;
    const problem = problemByKey.get(key);
    if (problem === undefined) {
      throw new Error(`Source report references unknown problem: ${key}`);
    }
    return {
      problem,
      runIndex: run.runIndex,
      replaces: {
        sourceReportPath: sourceReportRelativePath,
        sourceRunId: sourceReport.runId,
        artifactDir: run.artifactDir,
        solverExitCode: run.solverExitCode,
        timedOut: run.timedOut,
      },
    };
  });
  const problems = uniqueProblems(tasks.map((task) => task.problem));
  const rerunRuns: SourceRun[] = failedRuns.map((run) => ({
    problemId: run.problemId,
    group: run.group,
    runIndex: run.runIndex,
    artifactDir: run.artifactDir,
    solverExitCode: run.solverExitCode,
    timedOut: run.timedOut,
  }));
  return {
    sourceReport,
    problems,
    tasks,
    reportRerunOf: {
      sourceReportPath: sourceReportRelativePath,
      sourceRunId: sourceReport.runId,
      runs: rerunRuns,
    },
  };
}

async function resolveExistingReportPath(
  packageRoot: string,
  reportFilePath: string,
): Promise<string> {
  const candidates = path.isAbsolute(reportFilePath)
    ? [reportFilePath]
    : [path.resolve(packageRoot, reportFilePath), path.resolve(packageRoot, "..", reportFilePath)];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next common invocation style.
    }
  }
  throw new Error(`Report not found: ${reportFilePath}`);
}

function uniqueProblems(problems: Problem[]): Problem[] {
  const seen = new Set<string>();
  const unique: Problem[] = [];
  for (const problem of problems) {
    const key = `${problem.group}/${problem.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(problem);
  }
  return unique;
}

function trimReportText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length <= 1_000 ? trimmed : trimmed.slice(-1_000);
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
