import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRunCommand } from "./args";
import { classifySolverFailure, writeArtifactSummary } from "./artifact-summary";
import { gradeCommand } from "./grade";
import { discoverProblems, selectProblems } from "./problems";
import { createRunReport, reportPath, resolveExistingReportPath, writeReport } from "./report";
import { packSdk } from "./sdk-pack";
import { createSolverRuntime } from "./solver";
import { INFRASTRUCTURE_FAILURE_KINDS } from "./types";
import { createRunId, runWithConcurrency, tailText, toContainerName } from "./utils";
import { writeVerificationSummary } from "./verification";
import { prepareWorkspace, profileForProblem, pruneWorkspaceDeps } from "./workspace";
import type {
  ChallengeReport,
  ChallengeRunReport,
  Problem,
  RunOptions,
  SolverAgent,
  SolverFailureKind,
  StoredChallengeReport,
} from "./types";

type RunTask = {
  problem: Problem;
  runIndex: number;
  replaces?: ChallengeRunReport["replaces"];
};

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (argv[0] === "grade") {
    await gradeCommand(argv.slice(1), packageRoot);
    return;
  }
  const options = parseRunCommand(argv);
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
  const solverSettings =
    rerunPlan === undefined ? options : inheritSolverSettings(options, rerunPlan.sourceReport);

  const runId = createRunId();
  const outputDir = path.resolve(packageRoot, options.output ?? path.join("results", runId));
  await fs.mkdir(outputDir, { recursive: true });
  // Persist the pnpm store outside the per-run output dir so packages are
  // hardlinked across runs instead of being re-downloaded into every results/<runId>.
  const sharedPnpmStoreRoot = path.resolve(packageRoot, ".cache", "pnpm-store");
  await fs.mkdir(sharedPnpmStoreRoot, { recursive: true });

  const runtime = await createSolverRuntime(solverSettings.agent, packageRoot);
  console.log(`Preflight ${solverSettings.agent} ${runtime.image}`);
  const preflight = options.preflight
    ? await runtime.preflight(solverSettings.model)
    : { skipped: true as const };
  if (!preflight.skipped && preflight.exitCode !== 0) {
    throw new Error(
      `${solverSettings.agent} runner preflight failed with exit=${preflight.exitCode ?? "unknown"}${
        preflight.stderr ? `\n${preflight.stderr.trim()}` : ""
      }`,
    );
  }
  console.log(
    preflight.skipped
      ? "Preflight skipped"
      : `Preflight ok${preflight.agentVersion ? ` (${preflight.agentVersion})` : ""}`,
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
  try {
    console.log(`SDK ${packedSdk.sdkRef.slice(0, 12)} packaged`);

    const report: ChallengeReport = {
      schemaVersion: 2,
      runId,
      timestamp: new Date().toISOString(),
      agent: solverSettings.agent,
      sdkRef: packedSdk.sdkRef,
      sdkVersion: packedSdk.sdkVersion,
      requestedProfile: options.profile,
      model: solverSettings.model,
      effort: solverSettings.effort,
      runsPerProblem: rerunPlan?.sourceReport.runsPerProblem ?? options.runs,
      runner: {
        image: runtime.image,
        agentPackage: runtime.agentPackage,
        agentVersion: preflight.skipped ? undefined : preflight.agentVersion,
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
    // Serialize report writes. `report` only grows (runs are pushed), so chaining
    // the writes keeps the on-disk file monotonic: a slow older snapshot can never
    // land after a newer one and drop completed runs if the process is interrupted.
    let reportWrite: Promise<unknown> = Promise.resolve();
    const persistReport = (): Promise<void> => {
      const next = reportWrite.catch(() => {}).then(() => writeReport(reportFilePath, report));
      reportWrite = next;
      return next;
    };
    await persistReport();

    const tasks: RunTask[] =
      rerunPlan?.tasks ??
      problems.flatMap((problem) =>
        Array.from({ length: options.runs }, (_, runIndex) => ({
          problem,
          runIndex,
        })),
      );

    printHeader();
    await runWithConcurrency(tasks, options.concurrency, async (task) => {
      const profile = profileForProblem(task.problem, options.profile);
      const sdkTarballPath =
        profile === "no-docs"
          ? requiredNoDocsTarball(packedSdk.noDocsTarballPath)
          : packedSdk.fullTarballPath;
      const sharedPnpmStorePath = path.join(sharedPnpmStoreRoot, profile ?? "cli");
      await fs.mkdir(sharedPnpmStorePath, { recursive: true });
      const paths = await prepareWorkspace({
        outputDir,
        problem: task.problem,
        runIndex: task.runIndex,
        sdkTarballPath,
      });
      try {
        const result = await runtime.run({
          containerName: toContainerName(runId, task.problem.group, task.problem.id, task.runIndex),
          worktreePath: paths.worktreePath,
          promptPath: paths.promptPath,
          solverStdoutPath: paths.solverStdoutPath,
          solverStderrPath: paths.solverStderrPath,
          tracePath: paths.tracePath,
          model: solverSettings.model,
          effort: solverSettings.effort,
          maxSeconds: options.maxSeconds,
          sharedPnpmStorePath,
        });
        const failureKind = await classifySolverFailure({
          agent: solverSettings.agent,
          requestedModel: solverSettings.model,
          timedOut: result.timedOut,
          solverExitCode: result.exitCode,
          tracePath: paths.tracePath,
          solverStdoutPath: paths.solverStdoutPath,
          solverStderrPath: paths.solverStderrPath,
        });
        const artifactSummary = await writeArtifactSummary({
          problem: task.problem,
          runIndex: task.runIndex,
          worktreePath: paths.worktreePath,
          tracePath: paths.tracePath,
          solverStdoutPath: paths.solverStdoutPath,
          solverStderrPath: paths.solverStderrPath,
          artifactSummaryPath: paths.artifactSummaryPath,
          agent: solverSettings.agent,
          solverExitCode: result.exitCode,
          timedOut: result.timedOut,
          failureKind,
        });
        await writeVerificationSummary({
          problem: task.problem,
          runIndex: task.runIndex,
          worktreePath: paths.worktreePath,
          verifierImage: runtime.image,
          verificationSummaryPath: paths.verificationSummaryPath,
          verificationStdoutPath: paths.verificationStdoutPath,
          verificationStderrPath: paths.verificationStderrPath,
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
          failureKind,
          agentResult: artifactSummary.agentResult,
          replaces: task.replaces,
        });
        report.runs.push(runReport);
        await persistReport();
        printRun(task, reportPath(packageRoot, paths.artifactDir), result, failureKind);
        if (STOP_RUN_FAILURE_KINDS.has(failureKind)) {
          throw new Error(
            `Stopping after a ${failureKind} failure in ${task.problem.group}/${task.problem.id} run ${task.runIndex}; rerun the remaining problems once it is resolved`,
          );
        }
      } finally {
        // Always reclaim the per-problem node_modules/.pnpm-store so a failure or
        // interrupt mid-run doesn't leave hundreds of MB per worktree behind.
        // Swallow prune errors so they can't mask the original solver failure.
        if (options.pruneWorkspaceDeps) {
          try {
            await pruneWorkspaceDeps(paths.worktreePath);
          } catch (pruneError) {
            console.warn(
              `Failed to prune ${paths.worktreePath}: ${pruneError instanceof Error ? pruneError.message : String(pruneError)}`,
            );
          }
        }
      }
    });
    // Finish with the complete in-memory report once all serialized writes settle.
    await persistReport();
    console.log(`Report ${reportPath(packageRoot, reportFilePath)}`);
  } finally {
    await packedSdk.cleanup();
  }
}

const STOP_RUN_FAILURE_KINDS = new Set<SolverFailureKind>(["usage-limit", "auth"]);

function inheritSolverSettings(
  options: RunOptions,
  sourceReport: StoredChallengeReport,
): { agent: SolverAgent; model: string; effort: string } {
  const source = {
    agent: sourceReport.agent ?? "codex",
    model: sourceReport.model,
    effort: sourceReport.effort,
  };
  const conflicts = [
    options.agentExplicit && options.agent !== source.agent
      ? `--agent ${options.agent}`
      : undefined,
    options.modelExplicit && options.model !== source.model
      ? `--model ${options.model}`
      : undefined,
    options.effortExplicit && options.effort !== source.effort
      ? `--effort ${options.effort}`
      : undefined,
  ].filter((conflict) => conflict !== undefined);
  if (conflicts.length > 0) {
    throw new Error(
      `--rerun-nonzero-from reruns with the source report's ${source.agent}/${source.model}/${source.effort}; remove ${conflicts.join(", ")}`,
    );
  }
  return source;
}

async function createRerunPlan(options: {
  packageRoot: string;
  reportFilePath: string;
  allProblems: Problem[];
  selectedProblems: Problem[];
}): Promise<{
  sourceReport: StoredChallengeReport;
  problems: Problem[];
  tasks: RunTask[];
  reportRerunOf: NonNullable<ChallengeReport["rerunOf"]>;
}> {
  const sourceReportPath = await resolveExistingReportPath(
    options.packageRoot,
    options.reportFilePath,
  );
  const sourceReport = JSON.parse(
    await fs.readFile(sourceReportPath, "utf8"),
  ) as StoredChallengeReport;
  const selectedKeys = new Set(
    options.selectedProblems.map((problem) => `${problem.group}/${problem.id}`),
  );
  const problemByKey = new Map(
    options.allProblems.map((problem) => [`${problem.group}/${problem.id}`, problem]),
  );
  const failedRuns = sourceReport.runs
    .filter(
      (run) =>
        run.timedOut ||
        run.solverExitCode !== 0 ||
        (run.failureKind !== undefined && INFRASTRUCTURE_FAILURE_KINDS.has(run.failureKind)),
    )
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
  const rerunRuns: NonNullable<ChallengeReport["rerunOf"]>["runs"] = failedRuns.map((run) => ({
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
  return tailText(trimmed);
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
  failureKind: SolverFailureKind,
): void {
  const problemName = `${task.problem.group}/${task.problem.id}`;
  const solver = result.timedOut
    ? "timeout"
    : `exit=${result.exitCode ?? "unknown"}${failureKind === "none" ? "" : ` (${failureKind})`}`;
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
