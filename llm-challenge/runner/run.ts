import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { copyDir, listProblems, loadMeta } from "../shared/helpers";
import type { ProblemMeta } from "../shared/helpers";
import { calculateScore, createReport, formatReportTable } from "./score";
import type { ChallengeReport, ProblemResult, StageResult } from "./score";
import { checkAuthStatus, retrySolveProblem, solveProblem } from "./solve";
import type { SolveResult } from "./solve";
import { verifyProblem } from "./verify";

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
        implDir = requireArg(args, i, "--impl");
        i++;
        break;
      case "--impl-dir":
        implDir = requireArg(args, i, "--impl-dir");
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
    }
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
    retry,
    resume,
    rerunInfra,
  };
}

function setupWorkDir(problemDir: string, implDir?: string): string {
  const workDir = path.join(problemDir, "work");

  // Clean previous work directory
  if (fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true });
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
  const content = fs.readFileSync(pkgPath, "utf-8");
  const sdkPath = path.relative(workDir, path.join(challengeRoot, "..", "packages", "sdk"));
  const updated = content.replace(/"workspace:\^"/g, `"link:${sdkPath}"`);
  fs.writeFileSync(pkgPath, updated);
}

function installDependencies(workDir: string): void {
  console.log("  Installing dependencies...");
  rewriteWorkspaceRefs(workDir);
  execSync("pnpm install --no-lockfile", {
    cwd: workDir,
    encoding: "utf-8",
    timeout: 60_000,
    stdio: ["pipe", "pipe", "pipe"],
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

function runProblem(
  problemName: string,
  options: {
    implDir?: string;
    solve?: { model: string; maxBudget: number; retry: number };
    clean: boolean;
  },
): ProblemResult {
  const problemStartTime = Date.now();
  const problemDir = path.join(challengeRoot, "problems", problemName);
  const meta = loadMeta(problemDir);

  console.log(`\n--- Running problem: ${problemName} (${meta.difficulty}) ---`);

  const workDir = setupWorkDir(problemDir, options.implDir);
  installDependencies(workDir);

  let solveResult: SolveResult | undefined;
  const retrySolveResults: SolveResult[] = [];
  if (options.solve) {
    console.log(`  Solving with Claude Code (model: ${options.solve.model})...`);
    solveResult = solveProblem({
      workDir,
      problemDir,
      meta,
      model: options.solve.model,
      maxBudget: options.solve.maxBudget,
    });
    const icon = solveResult.success ? "ok" : solveResult.infraFailure ? "INFRA" : "FAIL";
    console.log(
      `  Solve: ${icon} ($${solveResult.costUsd.toFixed(4)}, ${(solveResult.durationMs / 1000).toFixed(1)}s)`,
    );
    if (solveResult.error) {
      console.log(`  Error: ${solveResult.error.slice(0, 200)}`);
    }
  }

  // If infra failure detected, skip verification entirely
  if (solveResult?.infraFailure) {
    console.log("  Skipping verification (infrastructure failure)");
    const stages = makeInfraFailureStages(meta);

    if (options.clean) {
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

  // Run verification stages
  let rawStages = verifyProblem(workDir, meta, challengeRoot);
  let stages = calculateScore(meta, rawStages);
  let totalScore = stages.reduce((sum, s) => sum + s.score, 0);
  let maxScore = stages.reduce((sum, s) => sum + s.maxScore, 0);

  // Retry loop (only in solve mode)
  if (options.solve && totalScore < maxScore) {
    const maxRetries = options.solve.retry;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Collect error output from failed stages
      const errorOutput = stages
        .filter((s) => !s.passed)
        .map((s) => `[${s.stage}] ${s.output}`)
        .join("\n\n");

      console.log(`  Retry ${attempt}/${maxRetries}...`);
      const retryResult = retrySolveProblem({
        workDir,
        problemDir,
        meta,
        model: options.solve.model,
        maxBudget: options.solve.maxBudget,
        errorOutput,
      });
      retrySolveResults.push(retryResult);
      const retryIcon = retryResult.success ? "ok" : "FAIL";
      console.log(
        `  Retry solve: ${retryIcon} ($${retryResult.costUsd.toFixed(4)}, ${(retryResult.durationMs / 1000).toFixed(1)}s)`,
      );

      // Re-verify
      rawStages = verifyProblem(workDir, meta, challengeRoot);
      stages = calculateScore(meta, rawStages);
      totalScore = stages.reduce((sum, s) => sum + s.score, 0);
      maxScore = stages.reduce((sum, s) => sum + s.maxScore, 0);

      if (totalScore === maxScore) {
        console.log(`  Retry ${attempt} succeeded!`);
        break;
      }
    }
  }

  for (const s of stages) {
    const icon = s.passed ? "ok" : s.score > 0 ? "PARTIAL" : "FAIL";
    console.log(`  ${s.stage}: ${icon} (${s.score}/${s.maxScore})`);
  }

  // Clean up work directory if --clean is specified
  if (options.clean) {
    fs.rmSync(workDir, { recursive: true });
  }

  return {
    problemId: meta.id,
    problemName: meta.name,
    difficulty: meta.difficulty,
    category: meta.category,
    stages,
    totalScore,
    maxScore,
    solveResult,
    retryCount: retrySolveResults.length > 0 ? retrySolveResults.length : undefined,
    retrySolveResults: retrySolveResults.length > 0 ? retrySolveResults : undefined,
    totalDurationMs: Date.now() - problemStartTime,
  };
}

function getPartialResultsPath(resultsDir: string): string {
  return path.join(resultsDir, ".partial-results.json");
}

function loadPartialResults(resultsDir: string): ProblemResult[] {
  const partialPath = getPartialResultsPath(resultsDir);
  if (!fs.existsSync(partialPath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(partialPath, "utf-8")) as ProblemResult[];
  } catch {
    return [];
  }
}

function savePartialResults(resultsDir: string, results: ProblemResult[]): void {
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(getPartialResultsPath(resultsDir), JSON.stringify(results, null, 2));
}

function cleanPartialResults(resultsDir: string): void {
  const partialPath = getPartialResultsPath(resultsDir);
  if (fs.existsSync(partialPath)) {
    fs.rmSync(partialPath);
  }
}

function findLatestReport(resultsDir: string): ChallengeReport | undefined {
  if (!fs.existsSync(resultsDir)) {
    return undefined;
  }
  const files = fs
    .readdirSync(resultsDir)
    .filter((f) => f.startsWith("report-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(
      fs.readFileSync(path.join(resultsDir, files[0]!), "utf-8"),
    ) as ChallengeReport;
  } catch {
    return undefined;
  }
}

function main(): void {
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
  } = parseArgs();

  if (!problem && !all && !rerunInfra) {
    console.error("Usage:");
    console.error("  tsx runner/run.ts --problem 001 --impl ./path/to/impl");
    console.error("  tsx runner/run.ts --problem 001 --use-solution");
    console.error("  tsx runner/run.ts --problem 001 --solve [--model sonnet] [--max-budget 2.00]");
    console.error("  tsx runner/run.ts --all --use-solution [--clean]");
    console.error(
      "  tsx runner/run.ts --all --solve [--model sonnet] [--max-budget 2.00] [--retry 2] [--clean]",
    );
    console.error("  tsx runner/run.ts --all --impl-dir ./path/to/all-outputs");
    console.error("  tsx runner/run.ts --all --solve --resume [--clean]");
    console.error("  tsx runner/run.ts --rerun-infra --solve [--model sonnet] [--clean]");
    process.exit(1);
  }

  const resultsDir = path.join(challengeRoot, "results");

  // Auth pre-check for solve mode
  if (solve || rerunInfra) {
    console.log("Checking authentication status...");
    const authCheck = checkAuthStatus();
    if (!authCheck.ok) {
      console.error(`Authentication check failed: ${authCheck.error}`);
      console.error("Please log in to Claude Code before running solve mode.");
      process.exit(1);
    }
    console.log("Authentication: ok");
  }

  // --rerun-infra mode: extract infra failure problems from latest report
  if (rerunInfra) {
    const latestReport = findLatestReport(resultsDir);
    if (!latestReport) {
      console.error("No existing report found. Run a full benchmark first.");
      process.exit(1);
    }

    const infraProblems = latestReport.results.filter((r) =>
      r.stages.every((s) => s.category === "infra_failure"),
    );
    if (infraProblems.length === 0) {
      console.log("No infrastructure failures found in latest report. Nothing to rerun.");
      process.exit(0);
    }

    console.log(`Rerunning ${infraProblems.length} infrastructure failure problem(s)...`);

    const rerunResults: ProblemResult[] = [];
    for (const infraResult of infraProblems) {
      const problemId = `${infraResult.problemId}-${infraResult.problemName}`;
      rerunResults.push(
        runProblem(problemId, {
          solve: { model, maxBudget, retry },
          clean,
        }),
      );
    }

    // Merge with existing results
    const mergedResults = latestReport.results.map((existing) => {
      const rerun = rerunResults.find(
        (r) => r.problemId === existing.problemId && r.problemName === existing.problemName,
      );
      return rerun ?? existing;
    });

    const sdkVersion = latestReport.sdkVersion;
    const report = createReport(mergedResults, {
      model: latestReport.model ?? model,
      sdkVersion,
    });

    console.log("\n" + formatReportTable(report));

    fs.mkdirSync(resultsDir, { recursive: true });
    const modelLabel = latestReport.model ?? model;
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

  // Resume support: load partial results and skip already-completed problems
  let results: ProblemResult[] = [];
  let completedIds = new Set<string>();
  if (resume) {
    results = loadPartialResults(resultsDir);
    completedIds = new Set(results.map((r) => `${r.problemId}-${r.problemName}`));
    if (results.length > 0) {
      console.log(`Resuming: ${results.length} problem(s) already completed, skipping.`);
    }
  }

  for (const p of problems) {
    // Skip already-completed problems in resume mode
    if (resume && completedIds.has(p)) {
      continue;
    }

    const problemDir = path.join(challengeRoot, "problems", p);

    if (solve) {
      const result = runProblem(p, {
        solve: { model, maxBudget, retry },
        clean,
      });
      results.push(result);

      // Save partial results after each problem
      if (all) {
        savePartialResults(resultsDir, results);
      }
    } else {
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

      results.push(runProblem(p, { implDir: impl, clean }));
    }
  }

  // Clean up partial results
  cleanPartialResults(resultsDir);

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
  });

  // Print table
  console.log("\n" + formatReportTable(report));

  // Write JSON results
  fs.mkdirSync(resultsDir, { recursive: true });
  const modelLabel = solve ? model : "solution";
  const versionLabel = sdkVersion ?? "unknown";
  const dateLabel = new Date().toISOString().replace(/:/g, "-").slice(0, 19);
  const jsonPath = path.join(resultsDir, `report-${modelLabel}-${versionLabel}-${dateLabel}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nResults written to: ${jsonPath}`);
}

function findProblem(id: string): string {
  const problems = listProblems(challengeRoot);
  const match =
    problems.find((p) => p === id) ??
    problems.find((p) => p.startsWith(`${id}-`)) ??
    problems.find((p) => p.startsWith(id));
  if (!match) {
    console.error(`Problem not found: ${id}`);
    process.exit(1);
  }
  return match;
}

main();
