import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { copyDir, listProblems, loadMeta } from "../shared/helpers";
import { calculateScore, createReport, formatReportTable } from "./score";
import type { ProblemResult } from "./score";
import { solveProblem } from "./solve";
import type { SolveResult } from "./solve";
import { verifyProblem } from "./verify";

const benchmarkRoot = path.resolve(import.meta.dirname, "..");

function parseArgs(): {
  problem?: string;
  all: boolean;
  implDir?: string;
  useSolution: boolean;
  solve: boolean;
  model: string;
  maxBudget: number;
  clean: boolean;
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

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--problem":
        problem = args[++i];
        break;
      case "--all":
        all = true;
        break;
      case "--impl":
        implDir = args[++i];
        break;
      case "--impl-dir":
        implDir = args[++i];
        break;
      case "--use-solution":
        useSolution = true;
        break;
      case "--solve":
        solve = true;
        break;
      case "--model":
        model = args[++i];
        break;
      case "--max-budget":
        maxBudget = Number(args[++i]);
        break;
      case "--clean":
        clean = true;
        break;
    }
  }

  return { problem, all, implDir, useSolution, solve, model, maxBudget, clean };
}

function setupWorkDir(problemDir: string, implDir?: string): string {
  const workDir = path.join(problemDir, "work");

  // Clean previous work directory
  if (fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true });
  }

  // 1. Copy shared scaffold
  const sharedScaffold = path.join(benchmarkRoot, "shared", "scaffold");
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

function installDependencies(workDir: string): void {
  console.log("  Installing dependencies...");
  try {
    execSync("pnpm install --frozen-lockfile", {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // pnpm install may fail with --frozen-lockfile in work dirs; retry without
    execSync("pnpm install", {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
}

function runProblem(
  problemName: string,
  options: {
    implDir?: string;
    solve?: { model: string; maxBudget: number };
    clean: boolean;
  },
): ProblemResult {
  const problemDir = path.join(benchmarkRoot, "problems", problemName);
  const meta = loadMeta(problemDir);

  console.log(`\n--- Running problem: ${problemName} (${meta.difficulty}) ---`);

  const workDir = setupWorkDir(problemDir, options.implDir);
  installDependencies(workDir);

  let solveResult: SolveResult | undefined;
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
  const rawStages = verifyProblem(workDir, meta, benchmarkRoot);
  const stages = calculateScore(meta, rawStages);
  const totalScore = stages.reduce((sum, s) => sum + s.score, 0);
  const maxScore = stages.reduce((sum, s) => sum + s.maxScore, 0);

  for (const s of stages) {
    const icon = s.passed ? "ok" : "FAIL";
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
  };
}

function main(): void {
  const { problem, all, implDir, useSolution, solve, model, maxBudget, clean } = parseArgs();

  if (!problem && !all) {
    console.error("Usage:");
    console.error("  tsx runner/run.ts --problem 001 --impl ./path/to/impl");
    console.error("  tsx runner/run.ts --problem 001 --use-solution");
    console.error("  tsx runner/run.ts --problem 001 --solve [--model sonnet] [--max-budget 2.00]");
    console.error("  tsx runner/run.ts --all --use-solution [--clean]");
    console.error(
      "  tsx runner/run.ts --all --solve [--model sonnet] [--max-budget 2.00] [--clean]",
    );
    console.error("  tsx runner/run.ts --all --impl-dir ./path/to/all-outputs");
    process.exit(1);
  }

  const problems = all ? listProblems(benchmarkRoot) : [findProblem(problem!)];
  const results: ProblemResult[] = [];

  for (const p of problems) {
    const problemDir = path.join(benchmarkRoot, "problems", p);

    if (solve) {
      results.push(
        runProblem(p, {
          solve: { model, maxBudget },
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

  const report = createReport(results);

  // Print table
  console.log("\n" + formatReportTable(report));

  // Write JSON results
  const resultsDir = path.join(benchmarkRoot, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const jsonPath = path.join(resultsDir, `report-${Date.now()}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nResults written to: ${jsonPath}`);
}

function findProblem(id: string): string {
  const problems = listProblems(benchmarkRoot);
  const match = problems.find((p) => p.startsWith(id));
  if (!match) {
    console.error(`Problem not found: ${id}`);
    process.exit(1);
  }
  return match;
}

main();
