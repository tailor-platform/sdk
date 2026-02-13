import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { copyDir, listProblems, loadMeta } from "../shared/helpers";
import { calculateScore, createReport, formatReportTable } from "./score";
import type { ProblemResult } from "./score";
import { retrySolveProblem, solveProblem } from "./solve";
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
    }
  }

  return { problem, all, implDir, useSolution, solve, model, maxBudget, clean, retry };
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

function runProblem(
  problemName: string,
  options: {
    implDir?: string;
    solve?: { model: string; maxBudget: number; retry: number };
    clean: boolean;
  },
): ProblemResult {
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
    const icon = solveResult.success ? "ok" : "FAIL";
    console.log(
      `  Solve: ${icon} ($${solveResult.costUsd.toFixed(4)}, ${(solveResult.durationMs / 1000).toFixed(1)}s)`,
    );
    if (solveResult.error) {
      console.log(`  Error: ${solveResult.error.slice(0, 200)}`);
    }
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
  };
}

function main(): void {
  const { problem, all, implDir, useSolution, solve, model, maxBudget, clean, retry } = parseArgs();

  if (!problem && !all) {
    console.error("Usage:");
    console.error("  tsx runner/run.ts --problem 001 --impl ./path/to/impl");
    console.error("  tsx runner/run.ts --problem 001 --use-solution");
    console.error("  tsx runner/run.ts --problem 001 --solve [--model sonnet] [--max-budget 2.00]");
    console.error("  tsx runner/run.ts --all --use-solution [--clean]");
    console.error(
      "  tsx runner/run.ts --all --solve [--model sonnet] [--max-budget 2.00] [--retry 2] [--clean]",
    );
    console.error("  tsx runner/run.ts --all --impl-dir ./path/to/all-outputs");
    process.exit(1);
  }

  const problems = all ? listProblems(challengeRoot) : [findProblem(problem!)];
  const results: ProblemResult[] = [];

  for (const p of problems) {
    const problemDir = path.join(challengeRoot, "problems", p);

    if (solve) {
      results.push(
        runProblem(p, {
          solve: { model, maxBudget, retry },
          clean,
        }),
      );
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
  const resultsDir = path.join(challengeRoot, "results");
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
