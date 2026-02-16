import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { copyDir, listProblems, loadMeta } from "../shared/helpers";
import type { ProblemMeta } from "../shared/helpers";
import { calculateScore, computeAdjustedScore, createReport, formatReportTable } from "./score";
import type { ChallengeReport, ProblemResult, StageResult } from "./score";
import { checkAuthStatus, retrySolveProblem, solveProblem } from "./solve";
import type { SolveResult } from "./solve";
import { verifyProblem } from "./verify";

const execAsync = promisify(exec);

const challengeRoot = path.resolve(import.meta.dirname, "..");

function requireArg(args: string[], i: number, flag: string): string {
  if (i + 1 >= args.length) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(1);
  }
  return args[i + 1]!;
}

function parseArgs(): {
  problem?: string;
  all: boolean;
  implDir?: string;
  useSolution: boolean;
  solve: boolean;
  model: string;
  maxBudget: number;
  clean: boolean;
  retry: number;
  resume: boolean;
  rerunInfra: boolean;
  concurrency: number;
} {
  const args = process.argv.slice(2);
  let problem: string | undefined;
  let all = false;
  let implDir: string | undefined;
  let useSolution = false;
  let solve = false;
  let model = "sonnet";
  let maxBudget = 2.0;
  let clean = false;
  let retry = 0;
  let resume = false;
  let rerunInfra = false;
  let concurrency = os.availableParallelism();

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--problem":
        problem = requireArg(args, i, "--problem");
        i++;
        break;
      case "--all":
        all = true;
        break;
      case "--impl":
      case "--impl-dir":
        implDir = requireArg(args, i, args[i]!);
        i++;
        break;
      case "--use-solution":
        useSolution = true;
        break;
      case "--solve":
        solve = true;
        break;
      case "--model":
        model = requireArg(args, i, "--model");
        i++;
        break;
      case "--max-budget":
        maxBudget = Number(requireArg(args, i, "--max-budget"));
        i++;
        break;
      case "--clean":
        clean = true;
        break;
      case "--retry":
        retry = Number(requireArg(args, i, "--retry"));
        i++;
        break;
      case "--resume":
        resume = true;
        break;
      case "--rerun-infra":
        rerunInfra = true;
        break;
      case "--concurrency":
        concurrency = Number(requireArg(args, i, "--concurrency"));
        i++;
        break;
    }
  }

  // Validate numeric arguments
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error("Error: --concurrency must be a positive integer");
    process.exit(1);
  }
  if (!Number.isInteger(retry) || retry < 0) {
    console.error("Error: --retry must be a non-negative integer");
    process.exit(1);
  }
  if (!Number.isFinite(maxBudget) || maxBudget <= 0) {
    console.error("Error: --max-budget must be a positive number");
    process.exit(1);
  }

  return {
    problem,
    all,
    implDir,
    useSolution,
    solve,
    model,
    maxBudget,
    clean,
    retry: Math.trunc(retry),
    resume,
    rerunInfra,
    concurrency: Math.trunc(concurrency),
  };
}

/**
 * Clean up previous work artifacts (symlink + tmpdir, or regular directory).
 */
function cleanupWorkArtifacts(problemDir: string): void {
  const workPath = path.join(problemDir, "work");
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(workPath);
  } catch {
    return; // Path doesn't exist at all
  }
  if (stat.isSymbolicLink()) {
    // Remove tmpdir target first, then symlink — only if target lives under os.tmpdir()
    try {
      const target = fs.realpathSync(fs.readlinkSync(workPath));
      const normalizedTmpdir = fs.realpathSync(os.tmpdir());
      const rel = path.relative(normalizedTmpdir, target);
      if (!rel.startsWith("..") && !path.isAbsolute(rel) && fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true });
      }
    } catch {
      // Broken symlink, just remove it
    }
    fs.rmSync(workPath);
  } else {
    fs.rmSync(workPath, { recursive: true });
  }
}

function setupWorkDir(problemDir: string, implDir?: string, useTmpDir?: boolean): string {
  // Clean previous work directory or symlink
  cleanupWorkArtifacts(problemDir);

  let workDir: string;
  if (useTmpDir) {
    const problemName = path.basename(problemDir);
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), `llm-challenge-${problemName}-`));
  } else {
    workDir = path.join(problemDir, "work");
  }

  // 1. Copy shared scaffold
  const sharedScaffold = path.join(challengeRoot, "shared", "scaffold");
  copyDir(sharedScaffold, workDir);

  // 2. Copy problem-specific scaffold (overrides shared)
  const problemScaffold = path.join(problemDir, "scaffold");
  if (fs.existsSync(problemScaffold)) {
    copyDir(problemScaffold, workDir);
  }

  // 3. Copy implementation files (overrides scaffold) - skip for --solve mode
  if (implDir) {
    copyDir(implDir, workDir);
  }

  return workDir;
}

function rewriteWorkspaceRefs(workDir: string): void {
  const pkgPath = path.join(workDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const sdkPath = path.resolve(challengeRoot, "..", "packages", "sdk");
  const linkRef = `link:${sdkPath.replace(/\\/g, "/")}`;
  for (const section of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [key, value] of Object.entries(deps)) {
      if (value === "workspace:^") {
        deps[key] = linkRef;
      }
    }
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

async function installDependencies(workDir: string, verbose: boolean): Promise<void> {
  if (verbose) {
    console.log("  Installing dependencies...");
  }
  rewriteWorkspaceRefs(workDir);
  await execAsync("pnpm install --no-lockfile --ignore-workspace", {
    cwd: workDir,
    encoding: "utf-8",
    timeout: 60_000,
  });
}

function makeInfraFailureStages(meta: ProblemMeta): StageResult[] {
  return (["generate", "typecheck", "tests"] as const).map((stage) => ({
    stage,
    passed: false,
    output: "Skipped (infrastructure failure)",
    score: 0,
    maxScore: meta.scoring[stage],
    category: "infra_failure" as const,
  }));
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            if (queue.length > 0) queue.shift()!();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

// Serialize pnpm install to avoid root node_modules race conditions
const installLimiter = createLimiter(1);

async function runProblem(
  problemName: string,
  options: {
    implDir?: string;
    solve?: { model: string; maxBudget: number; retry: number };
    clean: boolean;
    verbose: boolean;
  },
): Promise<ProblemResult> {
  const problemStartTime = Date.now();
  const problemDir = path.join(challengeRoot, "problems", problemName);
  const meta = loadMeta(problemDir);

  if (options.verbose) {
    console.log(`\n--- Running problem: ${problemName} (${meta.difficulty}) ---`);
  }

  const isSolveMode = !!options.solve;
  const workDir = setupWorkDir(problemDir, options.implDir, isSolveMode);
  await installLimiter(() => installDependencies(workDir, options.verbose));

  // In solve mode, workDir is a tmpdir. We'll create a symlink later for verify.
  const symlinkPath = path.join(problemDir, "work");

  let solveResult: SolveResult | undefined;
  const retrySolveResults: SolveResult[] = [];
  if (options.solve) {
    if (options.verbose) {
      console.log(`  Solving with Claude Code (model: ${options.solve.model})...`);
    }
    solveResult = await solveProblem({
      workDir,
      problemDir,
      meta,
      model: options.solve.model,
      maxBudget: options.solve.maxBudget,
    });
    if (options.verbose) {
      let icon = "FAIL";
      if (solveResult.success) {
        icon = "ok";
      } else if (solveResult.infraFailure) {
        icon = "INFRA";
      }
      console.log(
        `  Solve: ${icon} ($${solveResult.costUsd.toFixed(4)}, ${(solveResult.durationMs / 1000).toFixed(1)}s)`,
      );
      if (solveResult.error) {
        console.log(`  Error: ${solveResult.error.slice(0, 200)}`);
      }
    }
  }

  // If infra failure detected, skip verification entirely
  if (solveResult?.infraFailure) {
    if (options.verbose) {
      console.log("  Skipping verification (infrastructure failure)");
    }
    const stages = makeInfraFailureStages(meta);

    if (isSolveMode || options.clean) {
      fs.rmSync(workDir, { recursive: true });
    }

    return {
      problemId: meta.id,
      problemName: meta.name,
      difficulty: meta.difficulty,
      category: meta.category,
      stages,
      totalScore: 0,
      maxScore: stages.reduce((sum, s) => sum + s.maxScore, 0),
      solveResult,
      totalDurationMs: Date.now() - problemStartTime,
    };
  }

  // In solve mode, create symlink: problems/<name>/work → tmpdir
  // This ensures verify's path.dirname(workDir) resolves to problemDir for test paths
  if (isSolveMode) {
    fs.symlinkSync(workDir, symlinkPath);
  }
  const verifyWorkDir = isSolveMode ? symlinkPath : workDir;

  // Run verification stages
  let rawStages = await verifyProblem(verifyWorkDir, meta, challengeRoot);
  let stages = calculateScore(meta, rawStages);
  let totalScore = stages.reduce((sum, s) => sum + s.score, 0);
  let maxScore = stages.reduce((sum, s) => sum + s.maxScore, 0);

  // Record first-attempt score and stages before retries
  const firstAttemptScore = totalScore;
  const firstAttemptStages = stages.map((s) => ({ ...s }));

  // Retry loop (only in solve mode)
  if (options.solve && totalScore < maxScore) {
    const maxRetries = options.solve.retry;
    let cumulativeCost = solveResult?.costUsd ?? 0;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const remainingBudget = Math.max(0, options.solve.maxBudget - cumulativeCost);
      if (remainingBudget <= 0) {
        if (options.verbose) {
          console.log(
            `  Budget exhausted ($${cumulativeCost.toFixed(4)}), skipping retry ${attempt}`,
          );
        }
        break;
      }
      // Collect error output from failed stages
      const errorParts = stages
        .filter((s) => !s.passed)
        .map((s) => {
          let part = `[STAGE: ${s.stage}] ${s.output}`;
          if (s.stage === "tests" && s.testDetails) {
            const failedTests = s.testDetails.filter((t) => t.status === "failed");
            if (failedTests.length > 0) {
              const details = failedTests
                .map((t) => {
                  const msg = t.failureMessage ? `: ${t.failureMessage.split("\n")[0]}` : "";
                  return `  FAIL ${t.name}${msg}`;
                })
                .join("\n");
              part += `\n\nFailed tests:\n${details}`;
            }
          }
          return part;
        });
      const errorOutput = errorParts.join("\n\n");

      if (options.verbose) {
        console.log(`  Retry ${attempt}/${maxRetries}...`);
      }
      // Retry solve uses the actual workDir (tmpdir) for Claude execution
      const retryResult = await retrySolveProblem({
        workDir,
        problemDir,
        meta,
        model: options.solve.model,
        maxBudget: remainingBudget,
        errorOutput,
      });
      retrySolveResults.push(retryResult);
      cumulativeCost += retryResult.costUsd;
      if (options.verbose) {
        const retryIcon = retryResult.success ? "ok" : "FAIL";
        console.log(
          `  Retry solve: ${retryIcon} ($${retryResult.costUsd.toFixed(4)}, ${(retryResult.durationMs / 1000).toFixed(1)}s)`,
        );
      }

      // Re-verify using symlink path
      rawStages = await verifyProblem(verifyWorkDir, meta, challengeRoot);
      stages = calculateScore(meta, rawStages);
      totalScore = stages.reduce((sum, s) => sum + s.score, 0);
      maxScore = stages.reduce((sum, s) => sum + s.maxScore, 0);

      if (totalScore === maxScore) {
        if (options.verbose) {
          console.log(`  Retry ${attempt} succeeded!`);
        }
        break;
      }
    }
  }

  if (options.verbose) {
    for (const s of stages) {
      let icon = "FAIL";
      if (s.passed) {
        icon = "ok";
      } else if (s.score > 0) {
        icon = "PARTIAL";
      }
      console.log(`  ${s.stage}: ${icon} (${s.score}/${s.maxScore})`);
    }
  }

  // Clean up work artifacts if --clean is specified
  if (options.clean) {
    if (isSolveMode) {
      // Remove symlink and tmpdir
      cleanupWorkArtifacts(problemDir);
    } else {
      fs.rmSync(workDir, { recursive: true });
    }
  }

  const retryCount = retrySolveResults.length > 0 ? retrySolveResults.length : undefined;
  const result: ProblemResult = {
    problemId: meta.id,
    problemName: meta.name,
    difficulty: meta.difficulty,
    category: meta.category,
    stages,
    totalScore,
    maxScore,
    firstAttemptScore: retryCount != null ? firstAttemptScore : undefined,
    firstAttemptStages: retryCount != null ? firstAttemptStages : undefined,
    solveResult,
    retryCount,
    retrySolveResults: retrySolveResults.length > 0 ? retrySolveResults : undefined,
    totalDurationMs: Date.now() - problemStartTime,
  };
  result.adjustedScore = computeAdjustedScore(result);
  return result;
}

function getPartialResultsPath(resultsDir: string): string {
  return path.join(resultsDir, ".partial-results.json");
}

type PartialResultsFile = {
  model?: string;
  solve: boolean;
  implSource?: string;
  results: ProblemResult[];
};

function loadPartialResults(
  resultsDir: string,
  expectedModel?: string,
  expectedSolve?: boolean,
  expectedImplSource?: string,
): ProblemResult[] {
  const partialPath = getPartialResultsPath(resultsDir);
  if (!fs.existsSync(partialPath)) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(partialPath, "utf-8")) as
      | PartialResultsFile
      | ProblemResult[];
    // Support legacy format (plain array)
    if (Array.isArray(raw)) {
      return raw;
    }
    // Validate run configuration matches
    if (expectedModel != null && raw.model != null && raw.model !== expectedModel) {
      console.log(
        `Partial results model mismatch (${raw.model} vs ${expectedModel}), starting fresh.`,
      );
      return [];
    }
    if (expectedSolve != null && raw.solve !== expectedSolve) {
      console.log(`Partial results mode mismatch, starting fresh.`);
      return [];
    }
    if (
      expectedImplSource != null &&
      raw.implSource != null &&
      raw.implSource !== expectedImplSource
    ) {
      console.log(`Partial results implementation source mismatch, starting fresh.`);
      return [];
    }
    return raw.results;
  } catch {
    return [];
  }
}

function savePartialResults(
  resultsDir: string,
  results: ProblemResult[],
  model?: string,
  solve?: boolean,
  implSource?: string,
): void {
  fs.mkdirSync(resultsDir, { recursive: true });
  const data: PartialResultsFile = { model, solve: solve ?? false, implSource, results };
  fs.writeFileSync(getPartialResultsPath(resultsDir), JSON.stringify(data, null, 2));
}

function cleanPartialResults(resultsDir: string): void {
  const partialPath = getPartialResultsPath(resultsDir);
  if (fs.existsSync(partialPath)) {
    fs.rmSync(partialPath);
  }
}

function findLatestReport(
  resultsDir: string,
  options?: { solveOnly?: boolean },
): ChallengeReport | undefined {
  if (!fs.existsSync(resultsDir)) {
    return undefined;
  }
  const files = fs
    .readdirSync(resultsDir)
    .filter((f) => f.startsWith("report-") && f.endsWith(".json"));
  if (files.length === 0) {
    return undefined;
  }

  let latest: ChallengeReport | undefined;
  let latestTime = -1;
  for (const f of files) {
    try {
      const report = JSON.parse(
        fs.readFileSync(path.join(resultsDir, f), "utf-8"),
      ) as ChallengeReport;
      if (options?.solveOnly && !report.results.some((r) => r.solveResult !== undefined)) {
        continue;
      }
      const time = new Date(report.timestamp).getTime();
      if (time > latestTime) {
        latestTime = time;
        latest = report;
      }
    } catch {
      // Skip malformed report files
    }
  }
  return latest;
}

function formatDuration(ms: number): string {
  const secs = ms / 1000;
  const mins = Math.floor(secs / 60);
  const remainSecs = Math.round(secs % 60);
  return mins > 0 ? `${mins}m${remainSecs}s` : `${remainSecs}s`;
}

async function main(): Promise<void> {
  const {
    problem,
    all,
    implDir,
    useSolution,
    solve,
    model,
    maxBudget,
    clean,
    retry,
    resume,
    rerunInfra,
    concurrency,
  } = parseArgs();

  if (!problem && !all && !rerunInfra) {
    console.error("Usage:");
    console.error("  tsx runner/run.ts --problem 001 --impl ./path/to/impl");
    console.error("  tsx runner/run.ts --problem 001 --use-solution");
    console.error("  tsx runner/run.ts --problem 001 --solve [--model sonnet] [--max-budget 2.00]");
    console.error("  tsx runner/run.ts --all --use-solution [--clean] [--concurrency <n>]");
    console.error(
      "  tsx runner/run.ts --all --solve [--model sonnet] [--max-budget 2.00] [--retry 2] [--clean] [--concurrency <n>]",
    );
    console.error("  tsx runner/run.ts --all --impl-dir ./path/to/all-outputs");
    console.error("  tsx runner/run.ts --all --solve --resume [--clean]");
    console.error("  tsx runner/run.ts --rerun-infra --solve [--model sonnet] [--clean]");
    process.exit(1);
  }

  const resultsDir = path.join(challengeRoot, "results");
  const verbose = concurrency === 1;

  // Auth pre-check for solve mode
  if (solve || rerunInfra) {
    console.log("Checking authentication status...");
    const authCheck = await checkAuthStatus();
    if (!authCheck.ok) {
      console.error(`Authentication check failed: ${authCheck.error}`);
      console.error("Please log in to Claude Code before running solve mode.");
      process.exit(1);
    }
    console.log("Authentication: ok");
  }

  // --rerun-infra mode: extract infra failure problems from latest report
  if (rerunInfra) {
    const latestReport =
      findLatestReport(resultsDir, { solveOnly: true }) ?? findLatestReport(resultsDir);
    if (!latestReport) {
      console.error("No existing report found. Run a full benchmark first.");
      process.exit(1);
    }

    const infraProblems = latestReport.results.filter(
      (r) => r.stages.length > 0 && r.stages.every((s) => s.category === "infra_failure"),
    );
    if (infraProblems.length === 0) {
      console.log("No infrastructure failures found in latest report. Nothing to rerun.");
      process.exit(0);
    }

    console.log(
      `Rerunning ${infraProblems.length} infrastructure failure problem(s) (concurrency: ${concurrency})...`,
    );

    const rerunStartTime = Date.now();
    const limit = createLimiter(concurrency);
    const total = infraProblems.length;
    let completed = 0;
    const rerunResults = await Promise.all(
      infraProblems.map((infraResult) =>
        limit(async () => {
          const problemId = `${infraResult.problemId}-${infraResult.problemName}`;
          try {
            const result = await runProblem(problemId, {
              solve: { model, maxBudget, retry },
              clean,
              verbose,
            });
            completed++;
            if (!verbose) {
              const status = result.totalScore === result.maxScore ? "PASS" : "PARTIAL";
              console.log(
                `[${completed}/${total}] ${problemId}: ${status} (${result.totalScore}/${result.maxScore}) [${formatDuration(result.totalDurationMs ?? 0)}]`,
              );
            }
            return result;
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[ERROR] ${problemId}: ${errorMsg}`);
            completed++;
            // Return the original infra failure result so merged report is not missing entries
            return infraResult;
          }
        }),
      ),
    );

    // Merge with existing results
    const mergedResults = latestReport.results.map((existing) => {
      const rerun = rerunResults.find(
        (r) => r.problemId === existing.problemId && r.problemName === existing.problemName,
      );
      return rerun ?? existing;
    });

    const sdkVersion = latestReport.sdkVersion;
    // Preserve the model from the original report to avoid misattribution
    const reportModel = latestReport.model ?? model;
    const report = createReport(mergedResults, {
      model: reportModel,
      sdkVersion,
      elapsedMs: Date.now() - rerunStartTime,
    });

    console.log("\n" + formatReportTable(report));

    fs.mkdirSync(resultsDir, { recursive: true });
    const modelLabel = reportModel;
    const versionLabel = sdkVersion ?? "unknown";
    const dateLabel = new Date().toISOString().replace(/:/g, "-").slice(0, 19);
    const jsonPath = path.join(
      resultsDir,
      `report-${modelLabel}-${versionLabel}-${dateLabel}.json`,
    );
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`\nResults written to: ${jsonPath}`);
    return;
  }

  const problems = all ? listProblems(challengeRoot) : [findProblem(problem!)];

  if (all) {
    console.log(`Running ${problems.length} problem(s) (concurrency: ${concurrency})...`);
  }

  // Determine implementation source label for resume validation
  const implSource = solve ? "solve" : useSolution ? "solution" : (implDir ?? "unknown");

  // Resume support: load partial results and skip already-completed problems
  const results: ProblemResult[] = [];
  let completedIds = new Set<string>();
  const problemSet = new Set(problems);
  if (resume) {
    const partialResults = loadPartialResults(
      resultsDir,
      solve ? model : undefined,
      !!solve,
      implSource,
    );
    // Filter to only include results for problems in the current target set
    const relevantResults = partialResults.filter((r) =>
      problemSet.has(`${r.problemId}-${r.problemName}`),
    );
    results.push(...relevantResults);
    completedIds = new Set(relevantResults.map((r) => `${r.problemId}-${r.problemName}`));
    if (relevantResults.length > 0) {
      console.log(`Resuming: ${relevantResults.length} problem(s) already completed, skipping.`);
    }
  }

  // Build task list
  type ProblemTask = { problemName: string; implDir?: string };
  const tasks: ProblemTask[] = [];
  for (const p of problems) {
    if (resume && completedIds.has(p)) {
      continue;
    }

    if (solve) {
      tasks.push({ problemName: p });
    } else {
      const problemDir = path.join(challengeRoot, "problems", p);
      let impl: string;

      if (useSolution) {
        impl = path.join(problemDir, "solution");
      } else if (implDir) {
        impl = all ? path.join(implDir, p) : implDir;
      } else {
        console.error(`No implementation specified for problem ${p}`);
        process.exit(1);
      }

      if (!fs.existsSync(impl)) {
        console.error(`Implementation directory not found: ${impl}`);
        process.exit(1);
      }

      tasks.push({ problemName: p, implDir: impl });
    }
  }

  const limit = createLimiter(concurrency);
  const total = tasks.length + results.length;
  let completed = results.length;
  const runStartTime = Date.now();

  await Promise.all(
    tasks.map((task) =>
      limit(async () => {
        try {
          const result = await runProblem(task.problemName, {
            implDir: task.implDir,
            solve: solve ? { model, maxBudget, retry } : undefined,
            clean,
            verbose,
          });

          // Push result (safe: Node.js single-threaded)
          results.push(result);
          completed++;

          if (!verbose) {
            const status = result.totalScore === result.maxScore ? "PASS" : "PARTIAL";
            console.log(
              `[${completed}/${total}] ${task.problemName}: ${status} (${result.totalScore}/${result.maxScore}) [${formatDuration(result.totalDurationMs ?? 0)}]`,
            );
          }

          // Save partial results after each problem
          if (all) {
            savePartialResults(resultsDir, results, solve ? model : undefined, !!solve, implSource);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] ${task.problemName}: ${errorMsg}`);

          const problemDir = path.join(challengeRoot, "problems", task.problemName);
          const meta = loadMeta(problemDir);
          const stages = makeInfraFailureStages(meta);
          results.push({
            problemId: meta.id,
            problemName: meta.name,
            difficulty: meta.difficulty,
            category: meta.category,
            stages,
            totalScore: 0,
            maxScore: stages.reduce((sum, s) => sum + s.maxScore, 0),
            totalDurationMs: 0,
          });
          completed++;
        }
      }),
    ),
  );

  // Sort results by problemId for consistent report ordering
  results.sort((a, b) => a.problemId.localeCompare(b.problemId));

  // Clean up partial results only when running all problems
  if (all) {
    cleanPartialResults(resultsDir);
  }

  // Read SDK version from package.json
  let sdkVersion: string | undefined;
  try {
    const sdkPkgPath = path.join(challengeRoot, "..", "packages", "sdk", "package.json");
    const sdkPkg = JSON.parse(fs.readFileSync(sdkPkgPath, "utf-8")) as { version: string };
    sdkVersion = sdkPkg.version;
  } catch {
    // SDK package.json not found, skip version
  }

  const report = createReport(results, {
    model: solve ? model : undefined,
    sdkVersion,
    elapsedMs: Date.now() - runStartTime,
  });

  // Print table
  console.log("\n" + formatReportTable(report));

  // Write JSON results
  fs.mkdirSync(resultsDir, { recursive: true });
  const modelLabel = solve ? model : useSolution ? "solution" : "impl";
  const versionLabel = sdkVersion ?? "unknown";
  const dateLabel = new Date().toISOString().replace(/:/g, "-").slice(0, 19);
  const jsonPath = path.join(resultsDir, `report-${modelLabel}-${versionLabel}-${dateLabel}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nResults written to: ${jsonPath}`);
}

function findProblem(id: string): string {
  const problems = listProblems(challengeRoot);
  // Exact match first
  const exact = problems.find((p) => p === id);
  if (exact) {
    return exact;
  }
  // Prefix match with disambiguation: "001" matches "001-comprehensive-model"
  const prefixDash = problems.filter((p) => p.startsWith(`${id}-`));
  if (prefixDash.length === 1) {
    return prefixDash[0];
  }
  if (prefixDash.length > 1) {
    console.error(`Ambiguous problem ID "${id}" matches: ${prefixDash.join(", ")}`);
    process.exit(1);
  }
  // Fallback prefix match (no dash)
  const prefix = problems.filter((p) => p.startsWith(id));
  if (prefix.length === 1) {
    return prefix[0];
  }
  if (prefix.length > 1) {
    console.error(`Ambiguous problem ID "${id}" matches: ${prefix.join(", ")}`);
    process.exit(1);
  }
  console.error(`Problem not found: ${id}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
