import { exec, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type ContextProfile,
  copyDir,
  formatDuration,
  getSdkVersion,
  listProblems,
  loadMeta,
  problemKey,
  requireArg,
  sanitizeForFilename,
} from "../shared/helpers";
import type { ProblemMeta } from "../shared/helpers";
import {
  calculateScore,
  computeAdjustedScore,
  createReport,
  formatReportTable,
  isInfraFailure,
} from "./score";
import { applyContextProfile } from "./context-profile";
import { checkPodmanAvailability } from "./solver/container";
import type { ChallengeReport, ProblemResult, ScaffoldChange, StageResult } from "./score";
import {
  formatSolveModelLabel,
  normalizeModelForAgent,
  resolveRerunSolveConfig,
} from "./solve-model";
import { checkAuthStatus, retrySolveProblem, solveProblem } from "./solve";
import type { SolveAgent, SolveResult } from "./solve";
import { verifyProblem } from "./verify";

const execAsync = promisify(exec);

const challengeRoot = path.resolve(import.meta.dirname, "..");

function parseArgs(): {
  problem?: string;
  all: boolean;
  implDir?: string;
  useSolution: boolean;
  solve: boolean;
  agent: SolveAgent;
  agentExplicit: boolean;
  model?: string;
  modelExplicit: boolean;
  maxBudget: number;
  clean: boolean;
  retry: number;
  resume: boolean;
  rerunInfra: boolean;
  concurrency: number;
  contextProfile: ContextProfile;
  contextProfileExplicit: boolean;
} {
  const args = process.argv.slice(2);
  let problem: string | undefined;
  let all = false;
  let implDir: string | undefined;
  let useSolution = false;
  let solve = false;
  let agent: SolveAgent = "claude";
  let agentExplicit = false;
  let model: string | undefined;
  let modelExplicit = false;
  let maxBudget = 5.0;
  let clean = false;
  let retry = 0;
  let resume = false;
  let rerunInfra = false;
  let concurrency = os.availableParallelism();
  let contextProfile: ContextProfile = "full-package";
  let contextProfileExplicit = false;

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
        modelExplicit = true;
        i++;
        break;
      case "--agent": {
        const value = requireArg(args, i, "--agent");
        if (value !== "claude" && value !== "codex") {
          console.error(`Error: --agent must be either "claude" or "codex" (received: ${value})`);
          process.exit(1);
        }
        agent = value;
        agentExplicit = true;
        i++;
        break;
      }
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
      case "--context-profile": {
        const value = requireArg(args, i, "--context-profile");
        if (
          value !== "types-only" &&
          value !== "docs-only" &&
          value !== "tailor-sdk-skill" &&
          value !== "full-package"
        ) {
          console.error(
            'Error: --context-profile must be one of "types-only", "docs-only", "tailor-sdk-skill", or "full-package"',
          );
          process.exit(1);
        }
        contextProfile = value;
        contextProfileExplicit = true;
        i++;
        break;
      }
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
    agent,
    agentExplicit,
    model: model ?? (agent === "claude" ? "sonnet" : "gpt-5.4"),
    modelExplicit,
    maxBudget,
    clean,
    retry: Math.trunc(retry),
    resume,
    rerunInfra,
    concurrency: Math.trunc(concurrency),
    contextProfile,
    contextProfileExplicit,
  };
}

const contextProfileValues = [
  "types-only",
  "docs-only",
  "tailor-sdk-skill",
  "full-package",
] as const satisfies readonly ContextProfile[];

function isContextProfile(value: unknown): value is ContextProfile {
  return typeof value === "string" && (contextProfileValues as readonly string[]).includes(value);
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
  // Clean previous work directory or symlink
  cleanupWorkArtifacts(problemDir);

  let workDir: string;
  if (useTmpDir) {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-ws-"));
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

function packSdkTarball(): string {
  const sdkDir = path.resolve(challengeRoot, "..", "packages", "sdk");
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-pack-"));
  // Use execFileSync (no shell) to avoid command injection via TMPDIR.
  execFileSync("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: sdkDir,
    stdio: "pipe",
    timeout: 60_000,
  });
  const files = fs.readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
  if (files.length === 0) {
    throw new Error("pnpm pack produced no tarball");
  }
  return path.join(packDir, files[0]!);
}

function rewriteWorkspaceRefs(workDir: string, tarballPath?: string): void {
  const pkgPath = path.join(workDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;

  let ref: string;
  if (tarballPath) {
    // Copy the tarball into workDir so it remains accessible inside the Podman container.
    // The host tarball path is not mounted in the container, but workDir is mounted at
    // CONTAINER_WORK_DIR. Using a relative file: reference resolves correctly on both the
    // host (during the initial pnpm install) and inside the container (if the agent reruns it).
    const sdkDir = path.join(workDir, ".sdk");
    fs.mkdirSync(sdkDir, { recursive: true });
    fs.copyFileSync(tarballPath, path.join(sdkDir, "sdk.tgz"));
    ref = "file:./.sdk/sdk.tgz";
  } else {
    const sdkPath = path.resolve(challengeRoot, "..", "packages", "sdk");
    ref = `link:${sdkPath.replace(/\\/g, "/")}`;
  }

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

async function installDependencies(
  workDir: string,
  verbose: boolean,
  tarballPath?: string,
  contextProfile?: ContextProfile,
): Promise<void> {
  if (verbose) {
    console.log("  Installing dependencies...");
  }
  rewriteWorkspaceRefs(workDir, tarballPath);
  await execAsync("pnpm install --no-lockfile --ignore-workspace", {
    cwd: workDir,
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (contextProfile) {
    applyContextProfile(workDir, contextProfile);
  }
  // For filtered profiles drop the source tarball so solvers cannot reinstall
  // the unfiltered SDK and recover docs/skills the profile removed. Profiles that
  // do not filter (full-package, tailor-sdk-skill) keep the tarball so solvers can
  // refresh dependencies via `pnpm install` if needed.
  if (tarballPath && (contextProfile === "types-only" || contextProfile === "docs-only")) {
    fs.rmSync(path.join(workDir, ".sdk"), { recursive: true, force: true });
  }
}

const allStages = ["generate", "apiCheck", "typecheck", "tests"] as const;

function sumStageScores(stages: StageResult[]): { totalScore: number; maxScore: number } {
  return stages.reduce(
    (acc, s) => ({ totalScore: acc.totalScore + s.score, maxScore: acc.maxScore + s.maxScore }),
    { totalScore: 0, maxScore: 0 },
  );
}

function makeSkippedStages(
  meta: ProblemMeta,
  output: string,
  category: "infra_failure" | "runner_error",
): StageResult[] {
  const stages = meta.apiCheck ? allStages : allStages.filter((stage) => stage !== "apiCheck");
  return stages.map((stage) => ({
    stage,
    passed: false,
    output,
    score: 0,
    maxScore: meta.scoring[stage] ?? 0,
    category,
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

const scaffoldFilenames = ["tsconfig.json", "package.json"];

/**
 * Snapshot scaffold files so we can detect and restore modifications after solve.
 */
function snapshotScaffoldFiles(workDir: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const f of scaffoldFilenames) {
    const fp = path.join(workDir, f);
    if (fs.existsSync(fp)) {
      snapshot.set(f, fs.readFileSync(fp, "utf-8"));
    }
  }
  return snapshot;
}

/**
 * Restore scaffold files to their original content, returning any detected changes.
 */
function restoreScaffoldFiles(workDir: string, snapshot: Map<string, string>): ScaffoldChange[] {
  const changes: ScaffoldChange[] = [];
  for (const [f, original] of snapshot) {
    const fp = path.join(workDir, f);
    if (!fs.existsSync(fp)) {
      changes.push({ file: f, original, modified: "(deleted)" });
      fs.writeFileSync(fp, original);
    } else {
      const current = fs.readFileSync(fp, "utf-8");
      if (current !== original) {
        changes.push({ file: f, original, modified: current });
        fs.writeFileSync(fp, original);
      }
    }
  }
  return changes;
}

// Serialize pnpm install to avoid root node_modules race conditions
const installLimiter = createLimiter(1);

async function runProblem(
  problemName: string,
  options: {
    implDir?: string;
    solve?: { agent: SolveAgent; model?: string; maxBudget: number; retry: number };
    clean: boolean;
    verbose: boolean;
    tarballPath?: string;
    contextProfile: ContextProfile;
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
  try {
    await installLimiter(() =>
      installDependencies(workDir, options.verbose, options.tarballPath, options.contextProfile),
    );
  } catch (err) {
    // Clean up temporary solve directory on setup/install failure
    if (isSolveMode) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw err;
  }

  // In solve mode, workDir is a tmpdir. We'll create a symlink later for verify.
  const symlinkPath = path.join(problemDir, "work");

  // Snapshot scaffold files after install (before solve) to detect modifications
  const scaffoldSnapshot = isSolveMode ? snapshotScaffoldFiles(workDir) : new Map<string, string>();

  let solveResult: SolveResult | undefined;
  const retrySolveResults: SolveResult[] = [];
  const normalizedModel = options.solve
    ? normalizeModelForAgent(options.solve.agent, options.solve.model)
    : undefined;
  if (options.solve) {
    if (options.verbose) {
      const agentLabel = options.solve.agent === "claude" ? "Claude Code" : "Codex";
      console.log(`  Solving with ${agentLabel} (model: ${options.solve.model ?? "default"})...`);
    }
    solveResult = await solveProblem({
      workDir,
      problemDir,
      meta,
      agent: options.solve.agent,
      model: normalizedModel,
      maxBudget: options.solve.maxBudget,
      contextProfile: options.contextProfile,
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
    const stages = makeSkippedStages(meta, "Skipped (infrastructure failure)", "infra_failure");

    if (isSolveMode || options.clean) {
      fs.rmSync(workDir, { recursive: true });
    }

    return {
      problemId: meta.id,
      problemName: meta.name,
      difficulty: meta.difficulty,
      category: meta.category,
      apiSurfaces: meta.apiSurfaces,
      contextProfile: options.contextProfile,
      stages,
      totalScore: 0,
      maxScore: sumStageScores(stages).maxScore,
      solveResult,
      totalDurationMs: Date.now() - problemStartTime,
    };
  }

  // Detect and restore scaffold file modifications after solve
  const scaffoldChanges =
    isSolveMode && scaffoldSnapshot.size > 0 ? restoreScaffoldFiles(workDir, scaffoldSnapshot) : [];
  if (scaffoldChanges.length > 0 && options.verbose) {
    const files = scaffoldChanges.map((c) => c.file).join(", ");
    console.log(`  WARNING: Scaffold files modified during solve: ${files} (restored)`);
  }

  // In solve mode, create symlink: problems/<name>/work → tmpdir
  // This ensures verify's path.dirname(workDir) resolves to problemDir for test paths
  if (isSolveMode) {
    try {
      fs.symlinkSync(workDir, symlinkPath);
    } catch {
      // Fallback to junction for Windows environments without symlink privileges
      fs.symlinkSync(workDir, symlinkPath, "junction");
    }
  }
  const verifyWorkDir = isSolveMode ? symlinkPath : workDir;

  // Run verification stages
  let rawStages = await verifyProblem(verifyWorkDir, meta, challengeRoot);
  let stages = calculateScore(meta, rawStages);
  let { totalScore, maxScore } = sumStageScores(stages);

  // Record first-attempt score and stages before retries
  const firstAttemptScore = totalScore;
  const firstAttemptStages = stages.map((s) => ({ ...s }));

  // Retry loop (only in solve mode)
  if (options.solve && totalScore < maxScore) {
    const maxRetries = options.solve.retry;
    const maxInfraRetries = 3;
    let infraRetries = 0;
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
        agent: options.solve.agent,
        model: normalizedModel,
        maxBudget: remainingBudget,
        errorOutput,
        contextProfile: options.contextProfile,
      });
      retrySolveResults.push(retryResult);
      cumulativeCost += retryResult.costUsd;
      if (options.verbose) {
        const retryIcon = retryResult.success ? "ok" : "FAIL";
        console.log(
          `  Retry solve: ${retryIcon} ($${retryResult.costUsd.toFixed(4)}, ${(retryResult.durationMs / 1000).toFixed(1)}s)`,
        );
      }

      // Infra failures do not count against the retry budget
      if (retryResult.infraFailure) {
        infraRetries++;
        if (infraRetries >= maxInfraRetries) {
          if (options.verbose) {
            console.log(`  Too many consecutive infra failures (${infraRetries}), giving up`);
          }
          break;
        }
        if (options.verbose) {
          console.log(`  Retry ${attempt} was an infra failure, not counting against retry budget`);
        }
        attempt--;
        continue;
      }
      infraRetries = 0;

      // Restore scaffold files before re-verification
      const retryChanges = restoreScaffoldFiles(workDir, scaffoldSnapshot);
      if (retryChanges.length > 0) {
        scaffoldChanges.push(...retryChanges);
        if (options.verbose) {
          const files = retryChanges.map((c) => c.file).join(", ");
          console.log(`  Restored scaffold files modified during retry: ${files}`);
        }
      }

      // Re-verify using symlink path
      rawStages = await verifyProblem(verifyWorkDir, meta, challengeRoot);
      stages = calculateScore(meta, rawStages);
      ({ totalScore, maxScore } = sumStageScores(stages));

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

  // Exclude infra failure retries from retry count so they don't penalize adjusted score
  const nonInfraRetries = retrySolveResults.filter((r) => !r.infraFailure);
  const retryCount = nonInfraRetries.length > 0 ? nonInfraRetries.length : undefined;
  const result: ProblemResult = {
    problemId: meta.id,
    problemName: meta.name,
    difficulty: meta.difficulty,
    category: meta.category,
    apiSurfaces: meta.apiSurfaces,
    contextProfile: options.contextProfile,
    stages,
    totalScore,
    maxScore,
    firstAttemptScore: retryCount != null ? firstAttemptScore : undefined,
    firstAttemptStages: retryCount != null ? firstAttemptStages : undefined,
    solveResult,
    retryCount,
    retrySolveResults: retrySolveResults.length > 0 ? retrySolveResults : undefined,
    totalDurationMs: Date.now() - problemStartTime,
    scaffoldChanges: scaffoldChanges.length > 0 ? scaffoldChanges : undefined,
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
      if (options?.solveOnly && report.model === undefined) {
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

const authErrorPatterns = [
  /Not logged in/i,
  /API key/i,
  /authentication.*failed/i,
  /unauthorized/i,
  /codex login/i,
];

async function ensureAuthenticated(agent: SolveAgent, targetModel?: string): Promise<void> {
  console.log("Checking authentication status...");
  const authCheck = await checkAuthStatus({ agent, model: targetModel });
  if (!authCheck.ok) {
    console.error(`Authentication check failed: ${authCheck.error}`);
    const tool = agent === "claude" ? "Claude Code" : "Codex";
    if (authErrorPatterns.some((p) => p.test(authCheck.error ?? ""))) {
      console.error(`Please log in to ${tool} before running solve mode.`);
    } else {
      console.error(`Please check your ${tool} setup and try again.`);
    }
    if (agent === "claude") {
      console.error(
        'Hint: Run "claude setup-token" and set CLAUDE_CODE_OAUTH_TOKEN in your environment.',
      );
    } else {
      console.error('Hint: Run "codex login" to store credentials in ~/.codex/auth.json.');
    }
    process.exit(1);
  }
  console.log("Authentication: ok");
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
  const {
    problem,
    all,
    implDir,
    useSolution,
    solve,
    agent,
    agentExplicit,
    model,
    modelExplicit,
    maxBudget,
    clean,
    retry,
    resume,
    rerunInfra,
    concurrency,
    contextProfile: contextProfileArg,
    contextProfileExplicit,
  } = parseArgs();
  let contextProfile = contextProfileArg;

  if (!problem && !all && !rerunInfra) {
    console.error("Usage:");
    console.error("  tsx runner/run.ts --problem 001 --impl ./path/to/impl");
    console.error("  tsx runner/run.ts --problem 001 --use-solution");
    console.error(
      "  tsx runner/run.ts --problem 001 --solve [--agent claude|codex] [--model sonnet] [--max-budget 2.00] [--context-profile types-only]",
    );
    console.error("  tsx runner/run.ts --all --use-solution [--clean] [--concurrency <n>]");
    console.error(
      "  tsx runner/run.ts --all --solve [--agent claude|codex] [--model sonnet] [--max-budget 2.00] [--retry 2] [--clean] [--concurrency <n>] [--context-profile types-only]",
    );
    console.error("  tsx runner/run.ts --all --impl-dir ./path/to/all-outputs");
    console.error("  tsx runner/run.ts --all --solve --resume [--clean]");
    console.error(
      "  tsx runner/run.ts --rerun-infra --solve [--agent claude|codex] [--model sonnet] [--clean]",
    );
    console.error("\nNote: --solve requires Podman. On macOS, run 'podman machine start' first.");
    process.exit(1);
  }

  // Validate mutually exclusive flags
  if (problem && all) {
    console.error("Error: --problem and --all are mutually exclusive.");
    process.exit(1);
  }
  const implModes = [solve, useSolution, implDir].filter(Boolean).length;
  if (implModes > 1) {
    console.error("Error: --solve, --use-solution, and --impl are mutually exclusive.");
    process.exit(1);
  }

  const resultsDir = path.join(challengeRoot, "results");
  const verbose = concurrency === 1;
  const solveModelLabel = solve ? formatSolveModelLabel(agent, model) : undefined;

  // Podman is required for all solve paths (including rerun-infra)
  if (solve || rerunInfra) {
    const podmanStatus = checkPodmanAvailability();
    if (!podmanStatus.available) {
      console.error(`Error: ${podmanStatus.error}`);
      process.exit(1);
    }
  }

  // Auth pre-check for solve mode (skip when rerun-infra -- deferred until targets are known)
  if (solve && !rerunInfra) {
    await ensureAuthenticated(agent, normalizeModelForAgent(agent, model));
  }

  // Pack SDK tarball once for all solve-mode problems (eliminates link: path leaks).
  // Skip when --rerun-infra: packing is deferred until rerun targets are confirmed.
  let tarballPath: string | undefined;
  if (solve && !rerunInfra) {
    console.log("Packing SDK tarball...");
    tarballPath = packSdkTarball();
    console.log(`SDK tarball: ${tarballPath}`);
  }

  // --rerun-infra mode: extract infra failure problems from latest report
  if (rerunInfra) {
    const latestReport = findLatestReport(resultsDir, { solveOnly: true });
    if (!latestReport) {
      console.error("No solve-mode report found. Run a full benchmark with --solve first.");
      process.exit(1);
    }

    const infraProblems = latestReport.results.filter(isInfraFailure);
    if (infraProblems.length === 0) {
      console.log("No infrastructure failures found in latest report. Nothing to rerun.");
      process.exit(0);
    }

    // Without an explicit --context-profile, inherit the original report's profile
    // so the rerun keeps the same SDK context as the original benchmark.
    if (!contextProfileExplicit && isContextProfile(latestReport.contextProfile)) {
      contextProfile = latestReport.contextProfile;
      console.log(`Using context profile from previous report: ${contextProfile}`);
    }

    // Honor explicit flags; otherwise reuse the model/agent from the latest report.
    // Composite labels like "claude:sonnet+codex:default" are reduced to primary label.
    const { agent: rerunAgent, model: rerunModel } = resolveRerunSolveConfig({
      reportModelRaw: latestReport.model,
      agent,
      model,
      agentExplicit,
      modelExplicit,
    });

    // Auth pre-check (deferred until rerun options are derived)
    await ensureAuthenticated(rerunAgent, normalizeModelForAgent(rerunAgent, rerunModel));

    // Pack SDK tarball for rerun (deferred until rerun targets are confirmed)
    console.log("Packing SDK tarball...");
    tarballPath = packSdkTarball();
    console.log(`SDK tarball: ${tarballPath}`);

    console.log(
      `Rerunning ${infraProblems.length} infrastructure failure problem(s) (agent: ${rerunAgent}, model: ${rerunModel ?? "default"}, concurrency: ${concurrency})...`,
    );

    const rerunStartTime = Date.now();
    const limit = createLimiter(concurrency);
    const total = infraProblems.length;
    let completed = 0;
    const rerunResults = await Promise.all(
      infraProblems.map((infraResult) =>
        limit(async () => {
          const problemId = problemKey(infraResult.problemId, infraResult.problemName);
          try {
            const result = await runProblem(problemId, {
              solve: { agent: rerunAgent, model: rerunModel, maxBudget, retry },
              clean,
              verbose,
              tarballPath,
              contextProfile,
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
    const originalModel = latestReport.model;
    const rerunModelLabel = formatSolveModelLabel(rerunAgent, rerunModel);
    // When --model is explicit and differs from the original, create a composite label.
    // When --model is not explicit, preserve the original report's model label as-is
    // (it may already be composite from prior reruns).
    let reportModel: string;
    if ((modelExplicit || agentExplicit) && originalModel && rerunModelLabel !== originalModel) {
      reportModel = `${originalModel}+${rerunModelLabel}`;
    } else if (modelExplicit || agentExplicit) {
      reportModel = rerunModelLabel;
    } else {
      reportModel = originalModel ?? rerunModelLabel;
    }
    const report = createReport(mergedResults, {
      model: reportModel,
      contextProfile,
      sdkVersion,
      elapsedMs: Date.now() - rerunStartTime,
    });

    writeReport(resultsDir, report, reportModel, sdkVersion);
    return;
  }

  const problems = all ? listProblems(challengeRoot) : [findProblem(problem!)];

  if (all) {
    console.log(`Running ${problems.length} problem(s) (concurrency: ${concurrency})...`);
  }

  // Determine implementation source label for resume validation
  let implSource: string;
  if (solve) {
    implSource = "solve";
  } else if (useSolution) {
    implSource = "solution";
  } else {
    implSource = implDir ?? "unknown";
  }

  // Resume support: load partial results and skip already-completed problems
  const results: ProblemResult[] = [];
  let completedIds = new Set<string>();
  const problemSet = new Set(problems);
  if (resume) {
    const partialResults = loadPartialResults(
      resultsDir,
      solveModelLabel,
      !!solve,
      `${implSource}:${contextProfile}`,
    );
    // Filter to only include results for problems in the current target set
    const relevantResults = partialResults.filter((r) =>
      problemSet.has(problemKey(r.problemId, r.problemName)),
    );
    results.push(...relevantResults);
    completedIds = new Set(relevantResults.map((r) => problemKey(r.problemId, r.problemName)));
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
            solve: solve ? { agent, model, maxBudget, retry } : undefined,
            clean,
            verbose,
            tarballPath,
            contextProfile,
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
            savePartialResults(
              resultsDir,
              results,
              solveModelLabel,
              !!solve,
              `${implSource}:${contextProfile}`,
            );
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] ${task.problemName}: ${errorMsg}`);

          const problemDir = path.join(challengeRoot, "problems", task.problemName);
          const meta = loadMeta(problemDir);
          const stages = makeSkippedStages(
            meta,
            `Skipped (runner error: ${errorMsg})`,
            "runner_error",
          );
          results.push({
            problemId: meta.id,
            problemName: meta.name,
            difficulty: meta.difficulty,
            category: meta.category,
            apiSurfaces: meta.apiSurfaces,
            contextProfile,
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

  // Sort results by problemId for consistent report ordering
  results.sort((a, b) => a.problemId.localeCompare(b.problemId));

  // Clean up partial results only when running all problems
  if (all) {
    cleanPartialResults(resultsDir);
  }

  const sdkVersion = getSdkVersion(challengeRoot);

  const report = createReport(results, {
    model: solveModelLabel,
    contextProfile,
    sdkVersion,
    elapsedMs: Date.now() - runStartTime,
  });

  let modelLabelRaw: string;
  if (solve) {
    modelLabelRaw = `${solveModelLabel ?? "solve"}-${contextProfile}`;
  } else if (useSolution) {
    modelLabelRaw = `solution-${contextProfile}`;
  } else {
    modelLabelRaw = `impl-${contextProfile}`;
  }
  writeReport(resultsDir, report, modelLabelRaw, sdkVersion);
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
