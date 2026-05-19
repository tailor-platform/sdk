import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  copyDir,
  formatDuration,
  getSdkVersion,
  listProblems,
  loadMeta,
  requireArg,
  sanitizeForFilename,
} from "../shared/helpers";
import type { ProblemMeta } from "../shared/helpers";
import { buildPrompt } from "./prepare-prompt";
import { calculateScore, createReport, formatReportTable } from "./score";
import type { ChallengeReport, ProblemResult, StageResult } from "./score";
import { verifyProblem } from "./verify";

const execAsync = promisify(exec);

const challengeRoot = path.resolve(import.meta.dirname, "..");

function parseArgs(): {
  problem?: string;
  all: boolean;
  implDir?: string;
  useSolution: boolean;
  prepare: boolean;
  clean: boolean;
  concurrency: number;
} {
  const args = process.argv.slice(2);
  let problem: string | undefined;
  let all = false;
  let implDir: string | undefined;
  let useSolution = false;
  let prepare = false;
  let clean = false;
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
      case "--prepare":
        prepare = true;
        break;
      case "--clean":
        clean = true;
        break;
      case "--concurrency":
        concurrency = Number(requireArg(args, i, "--concurrency"));
        i++;
        break;
    }
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error("Error: --concurrency must be a positive integer");
    process.exit(1);
  }

  return {
    problem,
    all,
    implDir,
    useSolution,
    prepare,
    clean,
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
    return;
  }
  if (stat.isSymbolicLink()) {
    try {
      const target = fs.realpathSync(fs.readlinkSync(workPath));
      const normalizedTmpdir = fs.realpathSync(os.tmpdir());
      const rel = path.relative(normalizedTmpdir, target);
      if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) && fs.existsSync(target)) {
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
  cleanupWorkArtifacts(problemDir);

  let workDir: string;
  if (useTmpDir) {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-ws-"));
  } else {
    workDir = path.join(problemDir, "work");
  }

  const sharedScaffold = path.join(challengeRoot, "shared", "scaffold");
  copyDir(sharedScaffold, workDir);

  const problemScaffold = path.join(problemDir, "scaffold");
  if (fs.existsSync(problemScaffold)) {
    copyDir(problemScaffold, workDir);
  }

  if (implDir) {
    copyDir(implDir, workDir);
  }

  return workDir;
}

function rewriteWorkspaceRefs(workDir: string): void {
  const pkgPath = path.join(workDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;

  const sdkPath = path.resolve(challengeRoot, "..", "packages", "sdk");
  const ref = `link:${sdkPath.replace(/\\/g, "/")}`;

  for (const section of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [key, value] of Object.entries(deps)) {
      if (value === "workspace:^") {
        deps[key] = ref;
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
    timeout: 120_000,
  });
}

const allStages = ["generate", "typecheck", "tests"] as const;

function sumStageScores(stages: StageResult[]): { totalScore: number; maxScore: number } {
  return stages.reduce(
    (acc, s) => ({ totalScore: acc.totalScore + s.score, maxScore: acc.maxScore + s.maxScore }),
    { totalScore: 0, maxScore: 0 },
  );
}

function makeSkippedStages(meta: ProblemMeta, output: string): StageResult[] {
  return allStages.map((stage) => ({
    stage,
    passed: false,
    output,
    score: 0,
    maxScore: meta.scoring[stage],
    category: "runner_error",
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
  options: { implDir: string; clean: boolean; verbose: boolean },
): Promise<ProblemResult> {
  const problemStartTime = Date.now();
  const problemDir = path.join(challengeRoot, "problems", problemName);
  const meta = loadMeta(problemDir);

  if (options.verbose) {
    console.log(`\n--- Running problem: ${problemName} (${meta.difficulty}) ---`);
  }

  const workDir = setupWorkDir(problemDir, options.implDir);
  await installLimiter(() => installDependencies(workDir, options.verbose));

  const rawStages = await verifyProblem(workDir, meta, challengeRoot);
  const stages = calculateScore(meta, rawStages);
  const { totalScore, maxScore } = sumStageScores(stages);

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
    totalDurationMs: Date.now() - problemStartTime,
  };
}

async function preparePrompt(problemName: string): Promise<void> {
  const problemDir = path.join(challengeRoot, "problems", problemName);
  const meta = loadMeta(problemDir);

  const workDir = setupWorkDir(problemDir, undefined, true);
  await installDependencies(workDir, true);

  const prompt = buildPrompt(problemDir, meta, workDir);
  const promptPath = path.join(workDir, ".prompt.md");
  fs.writeFileSync(promptPath, prompt);

  console.log("");
  console.log(`workDir: ${workDir}`);
  console.log(`prompt:  ${promptPath}`);
  console.log(`Next:    cd ${workDir} && claude`);
}

function writeReport(
  resultsDir: string,
  report: ChallengeReport,
  modelLabel: string,
  sdkVersion: string | undefined,
): void {
  console.log("\n" + formatReportTable(report));

  fs.mkdirSync(resultsDir, { recursive: true });
  const safeName = sanitizeForFilename(modelLabel);
  const versionLabel = sdkVersion ?? "unknown";
  const dateLabel = new Date().toISOString().replace(/:/g, "-").slice(0, 19);
  const jsonPath = path.join(resultsDir, `report-${safeName}-${versionLabel}-${dateLabel}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nResults written to: ${jsonPath}`);
}

async function main(): Promise<void> {
  const { problem, all, implDir, useSolution, prepare, clean, concurrency } = parseArgs();

  if (!problem && !all) {
    console.error("Usage:");
    console.error("  tsx runner/run.ts --problem 001 --prepare");
    console.error("  tsx runner/run.ts --problem 001 --impl ./path/to/impl");
    console.error("  tsx runner/run.ts --problem 001 --use-solution");
    console.error("  tsx runner/run.ts --all --use-solution [--clean] [--concurrency <n>]");
    console.error("  tsx runner/run.ts --all --impl-dir ./path/to/all-outputs");
    process.exit(1);
  }

  if (problem && all) {
    console.error("Error: --problem and --all are mutually exclusive.");
    process.exit(1);
  }

  const implModes = [useSolution, implDir, prepare].filter(Boolean).length;
  if (implModes > 1) {
    console.error("Error: --prepare, --use-solution, and --impl are mutually exclusive.");
    process.exit(1);
  }

  if (prepare && all) {
    console.error("Error: --prepare requires a single --problem (not --all).");
    process.exit(1);
  }

  // --prepare: create workDir + install deps + write prompt, then exit
  if (prepare) {
    if (!problem) {
      console.error("Error: --prepare requires --problem.");
      process.exit(1);
    }
    await preparePrompt(findProblem(problem));
    return;
  }

  const problems = all ? listProblems(challengeRoot) : [findProblem(problem!)];

  if (all) {
    console.log(`Running ${problems.length} problem(s) (concurrency: ${concurrency})...`);
  }

  type ProblemTask = { problemName: string; implDir: string };
  const tasks: ProblemTask[] = [];
  for (const p of problems) {
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

  const verbose = concurrency === 1;
  const resultsDir = path.join(challengeRoot, "results");
  const limit = createLimiter(concurrency);
  const total = tasks.length;
  let completed = 0;
  const runStartTime = Date.now();
  const results: ProblemResult[] = [];

  await Promise.all(
    tasks.map((task) =>
      limit(async () => {
        try {
          const result = await runProblem(task.problemName, {
            implDir: task.implDir,
            clean,
            verbose,
          });

          results.push(result);
          completed++;

          if (!verbose) {
            const status = result.totalScore === result.maxScore ? "PASS" : "PARTIAL";
            console.log(
              `[${completed}/${total}] ${task.problemName}: ${status} (${result.totalScore}/${result.maxScore}) [${formatDuration(result.totalDurationMs ?? 0)}]`,
            );
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] ${task.problemName}: ${errorMsg}`);

          const problemDir = path.join(challengeRoot, "problems", task.problemName);
          const meta = loadMeta(problemDir);
          const stages = makeSkippedStages(meta, `Skipped (runner error: ${errorMsg})`);
          results.push({
            problemId: meta.id,
            problemName: meta.name,
            difficulty: meta.difficulty,
            category: meta.category,
            stages,
            totalScore: 0,
            maxScore: sumStageScores(stages).maxScore,
            totalDurationMs: 0,
          });
          completed++;
        }
      }),
    ),
  );

  results.sort((a, b) => a.problemId.localeCompare(b.problemId));

  const sdkVersion = getSdkVersion(challengeRoot);
  const report = createReport(results, {
    sdkVersion,
    elapsedMs: Date.now() - runStartTime,
  });

  const modelLabelRaw = useSolution ? "solution" : "impl";
  writeReport(resultsDir, report, modelLabelRaw, sdkVersion);
}

function findProblem(id: string): string {
  const problems = listProblems(challengeRoot);
  const exact = problems.find((p) => p === id);
  if (exact) {
    return exact;
  }
  const prefixDash = problems.filter((p) => p.startsWith(`${id}-`));
  if (prefixDash.length === 1) {
    return prefixDash[0];
  }
  if (prefixDash.length > 1) {
    console.error(`Ambiguous problem ID "${id}" matches: ${prefixDash.join(", ")}`);
    process.exit(1);
  }
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
