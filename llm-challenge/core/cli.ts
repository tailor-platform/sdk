import { exec, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  copyDir,
  createTimestampId,
  formatDuration,
  getSdkVersion,
  listProblems,
  problemKey,
  requireArg,
  sanitizeForFilename,
} from "../shared/helpers";
import { persistSolveAttemptArtifact } from "./artifacts";
import {
  appendCheckpoint,
  checkpointPath,
  deleteCheckpoint,
  groupCheckpoint,
  isCheckpointReusable,
  readCheckpoint,
} from "./checkpoint";
import {
  type ContextProfile,
  applyContextProfile,
  contextProfileValues,
  isContextProfile,
} from "./context-profile";
import { type TraceMetrics, computeLocStats, computeTraceMetrics } from "./metrics";
import { computeCanonicalnessStats } from "./metrics-canonicalness";
import {
  type ChallengeReport,
  type ProblemResult,
  type ScaffoldChange,
  type StageResult,
  aggregateIterations,
  createReport,
  finalizeStages,
  formatReportTable,
  isInfraFailure,
} from "./report";
import { formatSolveModelLabel, normalizeModelForAgent } from "./solve-model";
import { checkAuthStatus, solveProblem } from "./solve";
import type { SolveAgent, SolveResult } from "./solve";
import { checkPodmanAvailability } from "./solver/container";
import { extractRateLimitResetMs, isRateLimitError } from "./solver/shared";
import { verifyProblem } from "./verify";

const execAsync = promisify(exec);

const challengeRoot = path.resolve(import.meta.dirname, "..");

/**
 * Per-problem metadata read from `problems/<id>/meta.json`.
 *
 * Slim schema for the new core: no scoring weights, no apiCheck, no failure
 * categories. Pass/fail is binary per stage. `split` is preserved on the wire
 * for forward compatibility but is currently unused.
 *
 * Phase 2 micro-problems use a narrower schema (only `id`, `title`,
 * `designNote`, `sdkSurface`, `contextProfiles`, `hint`); legacy fields are
 * optional so the same loader handles both eras.
 */
export type ProblemMeta = {
  id: string;
  name?: string;
  /** Phase 2 micro-problems: human-readable title. */
  title?: string;
  /**
   * Phase 2 micro-problems: free-form note from the problem author describing
   * the affordance gap the problem is designed to exercise. Not read by the
   * runner; preserved as documentation of authorial intent.
   */
  designNote?: string;
  /** Phase 2 micro-problems: SDK surface area the problem targets. */
  sdkSurface?: string;
  /**
   * Author-only memo describing the affordance gap. The leading underscore
   * and the `Omit<…, "_hintAuthorOnly">` constraint on `buildPrompt`
   * (`solve.ts`) together prevent this field from being included in any
   * prompt sent to the agent. Updating problems must keep this field out of
   * `problem.md` text — that surface IS visible to the agent.
   */
  _hintAuthorOnly?: string;
  difficulty?: "easy" | "medium" | "hard";
  category?: string;
  split?: string;
  contextProfiles?: ContextProfile[];
  /**
   * Optional list of older problem IDs that referred to the same logical
   * task before a rename. Report aggregation can unify history across
   * renames by following this chain. Off by default — analyze pass through
   * `--unify-aliases` to opt in.
   */
  aliases?: string[];
  files?: {
    implement: string[];
    scaffold: string[];
  };
  /**
   * Optional extra CLI commands to run after `tailor-sdk generate` but
   * before `tsc --noEmit`. Each entry runs in the workDir as a binary
   * pass/fail stage; failure short-circuits subsequent stages. Targets
   * problems that exercise CLI subcommands beyond `generate` (e.g.
   * `tailor-sdk tailordb dump`, `tailor-sdk auth ...`).
   */
  verifyCommands?: string[];
};

function loadMeta(problemDir: string): ProblemMeta {
  const metaPath = path.join(problemDir, "meta.json");
  const content = fs.readFileSync(metaPath, "utf-8");
  const raw = JSON.parse(content) as ProblemMeta & { hint?: string };
  // Backwards compat: legacy `hint` field on meta.json is read as
  // `_hintAuthorOnly` so old problems continue to load. The TS type drops
  // `hint`, so downstream consumers cannot accidentally route it into a
  // prompt. New problems should write `_hintAuthorOnly` directly.
  if (raw.hint !== undefined && raw._hintAuthorOnly === undefined) {
    raw._hintAuthorOnly = raw.hint;
  }
  delete raw.hint;
  return raw;
}

/**
 * Derive a fallback `name` (everything after the `<id>-` prefix) from the
 * directory name. Used for Phase 2 micro-problems whose `meta.json` drops the
 * `name` field; `problemKey` and artifact paths still need a non-empty label.
 */
export function deriveProblemName(meta: ProblemMeta, dirName: string): string {
  if (meta.name) return meta.name;
  const prefix = `${meta.id}-`;
  return dirName.startsWith(prefix) ? dirName.slice(prefix.length) : dirName;
}

type ParsedArgs = {
  /**
   * Problem IDs explicitly requested via one or more `--problem <id>` flags.
   * Empty when `--all` is used. Supports multiple flags so callers (notably
   * `core/experiment.ts` forwarding `--problems m05,m18`) can target a
   * subset of problems for A/B candidate validation.
   */
  problemIds: string[];
  all: boolean;
  implDir?: string;
  useSolution: boolean;
  solve: boolean;
  agent: SolveAgent;
  model?: string;
  /** Per-problem budget cap (USD). The solver kills the agent run once a
   * single problem's spend crosses this number. */
  maxBudget: number;
  /**
   * Optional aggregate budget cap (USD) across the entire run. When set, the
   * problem loop breaks once `totalCostUsd` crosses this threshold and the
   * remaining tasks are recorded as `infraFailure: true (budget_exceeded)`
   * so a resume can pick them up later. Independent of `--max-budget`,
   * which only governs a single problem.
   */
  maxBudgetTotal?: number;
  clean: boolean;
  concurrency: number;
  contextProfile: ContextProfile;
  /**
   * Number of repeat solve attempts per (problem, agent, model, profile).
   * Defaults to 1 (single-run, backwards compatible). When > 1 the runner
   * loops the same task N times and aggregates variance into the new
   * `iterations` field of `ProblemResult`.
   */
  iterations: number;
  /**
   * True iff the user passed `--iterations` explicitly. When true the runner
   * never auto-extends — the explicit value is honoured verbatim. When false
   * (default), flaky middle-band results (passedCount in [1, count-1]) get an
   * extra 2 iterations to disambiguate variance.
   */
  iterationsExplicit: boolean;
  /**
   * True when `--no-auto-extend` was passed. Suppresses the flaky-middle-band
   * auto-extension even when iterations are at the default. Primarily a test
   * affordance.
   */
  noAutoExtend: boolean;
  /**
   * True when `--no-early-stop` was passed. Suppresses the agreement-based
   * early termination of the iteration loop, forcing every iteration to run.
   * Useful for tests that need deterministic iteration counts or for variance
   * audits where the full N samples are required.
   */
  noEarlyStop: boolean;
  /**
   * Optional git ref to `git worktree add` and `pnpm pack` instead of the
   * current working tree. Enables A/B benchmarking of SDK candidate branches
   * against the current branch (Phase 4 plan section "A/B 実験 + 統計化").
   */
  sdkBranch?: string;
  /**
   * Reuse the runId of a prior interrupted run. When set, the runner reads a
   * sidecar checkpoint file (`checkpoint-<runId>.jsonl`) under the same
   * results dir and skips (problem, iteration) pairs that already have a
   * non-infraFailure result. Missing or infraFailure iterations are re-run
   * into the same runId so the final report stitches old + new attempts.
   */
  resume?: string;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const problemIds: string[] = [];
  let all = false;
  let implDir: string | undefined;
  let useSolution = false;
  let solve = false;
  let agent: SolveAgent = "claude";
  let model: string | undefined;
  let maxBudget = 5.0;
  let maxBudgetTotal: number | undefined;
  let clean = false;
  let concurrency = os.availableParallelism();
  let contextProfile: ContextProfile = "full-package";
  let iterations: number | undefined;
  let noAutoExtend = false;
  let noEarlyStop = false;
  let sdkBranch: string | undefined;
  let resume: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--problem":
        problemIds.push(requireArg(args, i, "--problem"));
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
      case "--agent": {
        const value = requireArg(args, i, "--agent");
        if (value !== "claude" && value !== "codex" && value !== "oss") {
          console.error(
            `Error: --agent must be one of "claude", "codex", "oss" (received: ${value})`,
          );
          process.exit(1);
        }
        agent = value;
        i++;
        break;
      }
      case "--max-budget":
      case "--max-budget-per-problem":
        maxBudget = Number(requireArg(args, i, args[i]!));
        i++;
        break;
      case "--max-budget-total":
        maxBudgetTotal = Number(requireArg(args, i, "--max-budget-total"));
        i++;
        break;
      case "--clean":
        clean = true;
        break;
      case "--concurrency":
        concurrency = Number(requireArg(args, i, "--concurrency"));
        i++;
        break;
      case "--context-profile": {
        const value = requireArg(args, i, "--context-profile");
        if (!isContextProfile(value)) {
          console.error(
            `Error: --context-profile must be one of ${contextProfileValues.map((v) => `"${v}"`).join(", ")}`,
          );
          process.exit(1);
        }
        contextProfile = value;
        i++;
        break;
      }
      case "--iterations":
        iterations = Number(requireArg(args, i, "--iterations"));
        i++;
        break;
      case "--no-auto-extend":
        noAutoExtend = true;
        break;
      case "--no-early-stop":
        noEarlyStop = true;
        break;
      case "--sdk-branch":
        sdkBranch = requireArg(args, i, "--sdk-branch");
        i++;
        break;
      case "--resume":
        resume = requireArg(args, i, "--resume");
        i++;
        break;
    }
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error("Error: --concurrency must be a positive integer");
    process.exit(1);
  }
  if (!Number.isFinite(maxBudget) || maxBudget <= 0) {
    console.error("Error: --max-budget must be a positive number");
    process.exit(1);
  }
  if (maxBudgetTotal !== undefined && (!Number.isFinite(maxBudgetTotal) || maxBudgetTotal <= 0)) {
    console.error("Error: --max-budget-total must be a positive number");
    process.exit(1);
  }
  // --iterations: default to 3 in solve mode (per Phase 4 spec D 採点ベクトル
  // "N=3 反復"), default to 1 in verify modes for backward compat.
  const iterationsExplicit = iterations !== undefined;
  if (iterations === undefined) {
    iterations = solve ? 3 : 1;
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    console.error("Error: --iterations must be a positive integer");
    process.exit(1);
  }

  return {
    problemIds,
    all,
    implDir,
    useSolution,
    solve,
    agent,
    model: model ?? (agent === "claude" ? "sonnet" : agent === "oss" ? "gpt-oss:20b" : undefined),
    maxBudget,
    clean,
    concurrency: Math.trunc(concurrency),
    contextProfile,
    iterations,
    iterationsExplicit,
    noAutoExtend,
    noEarlyStop,
    ...(sdkBranch ? { sdkBranch } : {}),
    ...(resume ? { resume } : {}),
    ...(maxBudgetTotal !== undefined ? { maxBudgetTotal } : {}),
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
      if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) && fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    } catch {
      // Broken symlink, just remove it
    }
    fs.rmSync(workPath, { force: true });
  } else {
    fs.rmSync(workPath, { recursive: true, force: true });
  }
}

/**
 * Apply a list of source directories onto `workDir` in order. Each layer copies
 * its entire tree on top of the previous one; subsequent layers overwrite same-
 * named files at the destination (file-level shadowing). Non-existent source
 * directories are silently skipped, which lets callers express optional layers
 * (e.g. a micro-problem with no per-problem scaffold).
 */
export function applyScaffoldLayers(workDir: string, layers: readonly string[]): void {
  for (const layer of layers) {
    if (fs.existsSync(layer)) {
      copyDir(layer, workDir);
    }
  }
}

/**
 * Layered scaffold setup. Order matters — later layers shadow earlier ones at
 * file level, so a micro-problem's `scaffold/` always wins over `_shared/`.
 *
 * 1. `shared/scaffold/` — legacy global scaffold (package.json + tsconfig.json).
 * 2. `problems/_shared/scaffold/` — Phase 2 micro-problem common layer
 *    (tailor.config.ts + empty tailordb/).
 * 3. `problems/<id>/scaffold/` — per-problem overrides (may be absent or empty).
 * 4. `implDir` (optional) — solution / impl files for verify mode.
 */
function setupWorkDir(problemDir: string, implDir?: string, useTmpDir?: boolean): string {
  // For non-solve modes, work lives at problems/<id>/work and is shared; clean leftover state.
  // For solve mode, mkdtemp a fresh directory so parallel runs do not collide.
  if (!useTmpDir) {
    cleanupWorkArtifacts(problemDir);
  }

  let workDir: string;
  if (useTmpDir) {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-ws-"));
  } else {
    workDir = path.join(problemDir, "work");
  }

  const layers = [
    path.join(challengeRoot, "shared", "scaffold"),
    path.join(challengeRoot, "problems", "_shared", "scaffold"),
    path.join(problemDir, "scaffold"),
    ...(implDir ? [implDir] : []),
  ];
  applyScaffoldLayers(workDir, layers);

  return workDir;
}

export type PackedSdkTarball = {
  /** Path to the .tgz file `rewriteWorkspaceRefs` copies into each workDir. */
  tarballPath: string;
  /** Parent directory created via mkdtemp; callers must rm it when done. */
  packDir: string;
  /**
   * Optional ephemeral git worktree directory created by `packSdkFromRef`.
   * Callers must `git worktree remove --force` this path when done so the
   * candidate branch checkout is not left dangling.
   */
  worktreeDir?: string;
};

/**
 * Repo root (one level up from `packages/sdk/`) used as the cwd for `git`
 * commands that mutate the parent repository's worktree list.
 */
function sdkRepoRoot(): string {
  return path.resolve(challengeRoot, "..");
}

function packSdkTarball(): PackedSdkTarball {
  const sdkDir = path.resolve(challengeRoot, "..", "packages", "sdk");
  return packSdkAt(sdkDir);
}

/**
 * Run `pnpm pack` in `sdkDir` and capture the resulting .tgz. Extracted so
 * both the in-tree and branch-checkout flows share a single tarball-shape
 * contract.
 */
function packSdkAt(sdkDir: string): PackedSdkTarball {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-pack-"));
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", packDir], {
      cwd: sdkDir,
      stdio: "pipe",
      timeout: 60_000,
    });
    const files = fs.readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
    if (files.length === 0) {
      throw new Error("pnpm pack produced no tarball");
    }
    return { tarballPath: path.join(packDir, files[0]!), packDir };
  } catch (err) {
    fs.rmSync(packDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Result of a `git rev-parse --verify` call. Discriminates between a missing
 * ref (recoverable: surface a clear error) and any other failure mode.
 */
type RefCheckResult = { ok: true; sha: string } | { ok: false; reason: string };

function checkRefExists(repoRoot: string, ref: string): RefCheckResult {
  try {
    const stdout = execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 10_000,
    });
    return { ok: true, sha: stdout.trim() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message };
  }
}

/**
 * Create an ephemeral `git worktree` at the given ref, build the SDK there,
 * `pnpm pack` it, and return both the tarball path and the worktree dir so
 * the caller can clean it up. On any failure the worktree and its tmp dir
 * are removed.
 *
 * Edge cases:
 * - Missing ref: fails fast with a clear message.
 * - Stale worktree (e.g. previous run was killed mid-run): `git worktree prune`
 *   then retry once. We do NOT auto-`worktree remove` to avoid clobbering an
 *   in-progress concurrent run.
 */
export function packSdkFromRef(ref: string): PackedSdkTarball {
  const repoRoot = sdkRepoRoot();
  const refCheck = checkRefExists(repoRoot, ref);
  if (!refCheck.ok) {
    throw new Error(
      `[sdk-branch] Ref "${ref}" not found in repository (${refCheck.reason.split("\n")[0] ?? "unknown"})`,
    );
  }

  // Place worktree under .agent/tmp/ as suggested by Phase 4 plan. The dir
  // is gitignored at repo level (.agent/ is a conventional scratch path).
  const tmpRoot = path.join(repoRoot, ".agent", "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });
  // Use mkdtemp so concurrent invocations against the same ref don't collide.
  const worktreeDir = fs.mkdtempSync(path.join(tmpRoot, `sdk-branch-${sanitizeForFilename(ref)}-`));
  // mkdtempSync creates the dir; git worktree add needs the target NOT to
  // exist yet (git treats existing non-empty dirs as ambiguous). Remove the
  // empty tmp dir and let git recreate it at the same path.
  fs.rmdirSync(worktreeDir);

  const addWorktree = (): void => {
    execFileSync("git", ["worktree", "add", "--detach", worktreeDir, refCheck.sha], {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 30_000,
    });
  };

  try {
    addWorktree();
  } catch (err) {
    // Retry once after pruning stale worktrees.
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: repoRoot,
        stdio: "pipe",
        timeout: 10_000,
      });
      addWorktree();
    } catch (retryErr) {
      const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(
        `[sdk-branch] git worktree add failed for ref "${ref}": ${message.split("\n")[0] ?? "unknown"}`,
      );
    }
  }

  try {
    // Build the SDK in the new worktree before packing, since pnpm pack only
    // includes whatever is on disk.
    execFileSync("pnpm", ["-C", path.join(worktreeDir, "packages", "sdk"), "build"], {
      cwd: worktreeDir,
      stdio: "pipe",
      timeout: 300_000,
    });
    const packed = packSdkAt(path.join(worktreeDir, "packages", "sdk"));
    return { ...packed, worktreeDir };
  } catch (err) {
    cleanupWorktree(repoRoot, worktreeDir);
    throw err;
  }
}

/**
 * Remove an ephemeral worktree created by `packSdkFromRef`. Best effort —
 * swallows errors so cleanup never throws on the happy path.
 */
export function cleanupWorktree(repoRoot: string, worktreeDir: string): void {
  if (!fs.existsSync(worktreeDir)) {
    // Already cleaned up; nothing to do.
    return;
  }
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreeDir], {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch {
    // Fallback: rm the dir directly. Worktree metadata is salvaged by
    // `git worktree prune` on the next git invocation.
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }
}

function rewriteWorkspaceRefs(workDir: string, tarballPath?: string): void {
  const pkgPath = path.join(workDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;

  let ref: string;
  if (tarballPath) {
    // Copy the tarball into workDir so it remains accessible inside the Podman container.
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
  // the unfiltered SDK. Only `full-package` keeps the tarball.
  if (tarballPath && contextProfile && contextProfile !== "full-package") {
    fs.rmSync(path.join(workDir, ".sdk"), { recursive: true, force: true });
  }
}

const allStages = ["generate", "typecheck", "tests"] as const;

function makeSkippedStages(reason: string): StageResult[] {
  const skipped = `Skipped (${reason})`;
  return allStages.map((stage) => ({ stage, passed: false, output: skipped }));
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

const createRunId = createTimestampId;

function createRunArtifactRoot(
  resultsDir: string,
  modelLabel: string,
  sdkVersion: string | undefined,
  runId: string,
): string {
  const versionLabel = sdkVersion ?? "unknown";
  const safeName = sanitizeForFilename(modelLabel);
  return path.join(resultsDir, "artifacts", `${safeName}-${versionLabel}-${runId}`);
}

function createProblemArtifactRoot(
  runArtifactRoot: string | undefined,
  meta: ProblemMeta,
  dirName: string,
): string | undefined {
  if (!runArtifactRoot) {
    return undefined;
  }
  return path.join(
    runArtifactRoot,
    sanitizeForFilename(problemKey(meta.id, deriveProblemName(meta, dirName))),
  );
}

async function runProblem(
  problemName: string,
  options: {
    implDir?: string;
    solve?: { agent: SolveAgent; model?: string; maxBudget: number; seed?: number };
    clean: boolean;
    verbose: boolean;
    tarballPath?: string;
    contextProfile: ContextProfile;
    runArtifactRoot?: string;
  },
): Promise<ProblemResult> {
  const problemStartTime = Date.now();
  const problemDir = path.join(challengeRoot, "problems", problemName);
  const meta = loadMeta(problemDir);
  const resolvedName = deriveProblemName(meta, problemName);
  const resolvedDifficulty = meta.difficulty ?? "easy";
  const resolvedCategory = meta.category ?? meta.sdkSurface ?? "micro";

  if (options.verbose) {
    console.log(`\n--- Running problem: ${problemName} (${resolvedDifficulty}) ---`);
  }

  const isSolveMode = !!options.solve;
  const workDir = setupWorkDir(problemDir, options.implDir, isSolveMode);
  const problemArtifactRoot = createProblemArtifactRoot(options.runArtifactRoot, meta, problemName);
  try {
    await installLimiter(() =>
      installDependencies(workDir, options.verbose, options.tarballPath, options.contextProfile),
    );
  } catch (err) {
    if (isSolveMode) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw err;
  }

  // Snapshot scaffold files after install (before solve) to detect modifications
  const scaffoldSnapshot = isSolveMode ? snapshotScaffoldFiles(workDir) : new Map<string, string>();

  let solveResult: SolveResult | undefined;
  let metrics: TraceMetrics | undefined;
  const normalizedModel = options.solve
    ? normalizeModelForAgent(options.solve.agent, options.solve.model)
    : undefined;
  // Behaviour trace lives at <workDir>/.trace.jsonl during solve, then moves
  // to <artifactDir>/trace.jsonl after persistSolveAttemptArtifact creates
  // the attempt directory. Writing under workDir keeps the trace alive
  // through persistSolveAttemptArtifact's rmSync on the artifact dir.
  const traceWorkPath = options.solve ? path.join(workDir, ".trace.jsonl") : undefined;
  if (options.solve) {
    if (options.verbose) {
      const agentLabel =
        options.solve.agent === "claude"
          ? "Claude Code"
          : options.solve.agent === "oss"
            ? "opencode (OSS)"
            : "Codex";
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
      ...(options.solve.seed !== undefined ? { seed: options.solve.seed } : {}),
      ...(traceWorkPath ? { tracePath: traceWorkPath } : {}),
    });
    if (problemArtifactRoot) {
      const artifact = persistSolveAttemptArtifact({
        rootDir: problemArtifactRoot,
        attemptName: "attempt-0",
        result: solveResult,
        workDir,
      });
      // Move the in-workDir trace into the per-attempt artifact dir so it
      // survives workDir cleanup. Compute metrics from the final location.
      if (traceWorkPath && fs.existsSync(traceWorkPath)) {
        const targetTracePath = path.join(artifact.directory, "trace.jsonl");
        try {
          fs.renameSync(traceWorkPath, targetTracePath);
        } catch {
          // rename across devices can fail (workDir may be a tmpfs); fall back
          // to copy + remove rather than losing the trace.
          fs.copyFileSync(traceWorkPath, targetTracePath);
          fs.rmSync(traceWorkPath, { force: true });
        }
        metrics = computeTraceMetrics(targetTracePath);
      }
    } else if (traceWorkPath && fs.existsSync(traceWorkPath)) {
      // No artifact dir (legacy non-artifact runs): compute metrics in-place,
      // then drop the file with workDir.
      metrics = computeTraceMetrics(traceWorkPath);
    }
    // Measure LoC delta against the scaffold tree (the input the AI saw).
    // Built lazily in a tmpdir from the same layers setupWorkDir uses so a
    // raw `problems/<id>/scaffold` (which lacks shared layers) does not skew
    // the count. Skip on infra failure since workDir may be empty.
    if (metrics && !solveResult.infraFailure) {
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "llm-loc-base-"));
      try {
        applyScaffoldLayers(tmpBase, [
          path.join(challengeRoot, "shared", "scaffold"),
          path.join(challengeRoot, "problems", "_shared", "scaffold"),
          path.join(problemDir, "scaffold"),
        ]);
        const loc = computeLocStats(tmpBase, workDir);
        metrics = { ...metrics, ...loc };
      } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
      // Canonicalness: walk the work tree, classify @tailor-platform/* imports.
      // Ratio of 1.0 = every import is canonical; lower = invented or internal
      // sub-paths. Cheap regex scan, no AST.
      const canon = computeCanonicalnessStats(workDir);
      metrics = { ...metrics, canonicalImportRatio: canon.canonicalImportRatio };
    }
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
    const stages = makeSkippedStages("infrastructure failure");

    if (isSolveMode || options.clean) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }

    return {
      problemId: meta.id,
      problemName: resolvedName,
      difficulty: resolvedDifficulty,
      category: resolvedCategory,
      ...(meta.split !== undefined ? { split: meta.split } : {}),
      contextProfile: options.contextProfile,
      stages,
      passed: false,
      solveResult,
      totalDurationMs: Date.now() - problemStartTime,
      ...(problemArtifactRoot ? { artifacts: { directory: problemArtifactRoot } } : {}),
      ...(metrics ? { metrics } : {}),
    };
  }

  // Detect and restore scaffold file modifications after solve
  const scaffoldChanges =
    isSolveMode && scaffoldSnapshot.size > 0 ? restoreScaffoldFiles(workDir, scaffoldSnapshot) : [];
  if (scaffoldChanges.length > 0 && options.verbose) {
    const files = scaffoldChanges.map((c) => c.file).join(", ");
    console.log(`  WARNING: Scaffold files modified during solve: ${files} (restored)`);
  }

  // Run verification stages.
  const rawStages = await verifyProblem(workDir, problemDir, meta, challengeRoot);
  const stages = finalizeStages(rawStages);
  const passed = stages.every((s) => s.passed);

  if (options.verbose) {
    for (const s of stages) {
      const icon = s.passed ? "ok" : "FAIL";
      console.log(`  ${s.stage}: ${icon}`);
    }
  }

  // Solve mode tmpdirs have no other referrer; always remove. Non-solve modes only clean when asked.
  if (isSolveMode || options.clean) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  return {
    problemId: meta.id,
    problemName: resolvedName,
    difficulty: resolvedDifficulty,
    category: resolvedCategory,
    ...(meta.split !== undefined ? { split: meta.split } : {}),
    contextProfile: options.contextProfile,
    stages,
    passed,
    solveResult,
    totalDurationMs: Date.now() - problemStartTime,
    ...(scaffoldChanges.length > 0 ? { scaffoldChanges } : {}),
    ...(problemArtifactRoot ? { artifacts: { directory: problemArtifactRoot } } : {}),
    ...(metrics ? { metrics } : {}),
  };
}

function getRunResultsDir(resultsDir: string, modelLabelRaw: string): string {
  return path.join(resultsDir, sanitizeForFilename(modelLabelRaw));
}

/**
 * Recover the `work/` snapshot directory for a single iteration's artifact.
 * Returns `undefined` when the snapshot is missing (e.g. the iteration failed
 * before persistSolveAttemptArtifact could copy the work tree). The path
 * shape mirrors {@link persistSolveAttemptArtifact}: each iteration writes a
 * single `attempt-0/` per problem, so the work snapshot lives at
 * `<problemArtifactRoot>/attempt-0/work`.
 */
function getIterationWorkSnapshot(result: ProblemResult): string | undefined {
  const dir = result.artifacts?.directory;
  if (!dir) return undefined;
  const candidate = path.join(dir, "attempt-0", "work");
  return fs.existsSync(candidate) ? candidate : undefined;
}

/**
 * Compute and persist a `git diff --no-index <failingWork> <passingWork>` between
 * the first failing iteration's work snapshot and the first passing one for a
 * flaky problem (passRate strictly between 0 and 1). Writes to
 * `<runArtifactRoot>/iter-diff/<problemId>.diff`. No-op when:
 *
 * - the problem is not flaky (every iteration passed, or every one failed);
 * - either side has no work snapshot on disk (e.g. infra failure);
 * - `git diff --no-index` reports the two trees are identical (exit 0).
 *
 * `git diff --no-index` exits with code 1 when a diff exists — that is the
 * success case here; we only treat exit ≥ 2 as a real failure.
 *
 * Exposed for test injection: callers can pass a mock `runner` to avoid
 * spawning a real subprocess. In production code the default
 * `spawnSync('git', …)` is used.
 */
export type GitDiffRunner = (failingWork: string, passingWork: string) => GitDiffResult;
export type GitDiffResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

// Files filtered out of every iter-diff / fail-vs-solution.diff. These appear
// in every work tree (scaffold setup) and add no signal about how the AI
// deviated from the reference solution: package.json/tsconfig.json are
// scaffold boilerplate, .sdk holds the packed SDK tarball + extracted modules,
// .gitkeep markers flip on directory existence rather than content.
//
// Each entry matches any path containing the substring. `git diff --no-index`
// does not accept pathspec excludes, so we post-filter the stdout per-block.
export const EXCLUDED_DIFF_PATH_FRAGMENTS = [
  "/package.json",
  "/pnpm-lock.yaml",
  "/tsconfig.json",
  "/.sdk/",
  "/node_modules/",
  "/.gitkeep",
];

/**
 * Drop file-blocks from a unified `git diff --no-index` output whose
 * a/-side or b/-side path contains any fragment in
 * `EXCLUDED_DIFF_PATH_FRAGMENTS`. A "block" starts at a `diff --git ` line and
 * runs until the next one (or end-of-input). Anything before the first
 * `diff --git ` (e.g. a leading warning line) is preserved.
 */
export function filterExcludedFromDiff(stdout: string): string {
  if (!stdout.includes("diff --git ")) {
    return stdout;
  }
  const headerRegex = /^diff --git a\/(.+?) b\/(.+?)$/m;
  const blocks: string[] = [];
  // Split keeps the delimiter on the next chunk; use a manual scan instead.
  let cursor = 0;
  let preamble = "";
  const text = stdout;
  // Capture preamble before first header.
  const firstIdx = text.indexOf("diff --git ");
  if (firstIdx > 0) {
    preamble = text.slice(0, firstIdx);
    cursor = firstIdx;
  }
  while (cursor < text.length) {
    const next = text.indexOf("\ndiff --git ", cursor + 1);
    const end = next === -1 ? text.length : next + 1;
    blocks.push(text.slice(cursor, end));
    cursor = end;
  }
  const kept = blocks.filter((block) => {
    const m = block.match(headerRegex);
    if (!m) return true;
    const aPath = m[1] ?? "";
    const bPath = m[2] ?? "";
    return !EXCLUDED_DIFF_PATH_FRAGMENTS.some(
      (frag) => aPath.includes(frag) || bPath.includes(frag),
    );
  });
  return preamble + kept.join("");
}

const defaultGitDiffRunner: GitDiffRunner = (failingWork, passingWork) => {
  const result = spawnSync("git", ["diff", "--no-index", "--", failingWork, passingWork], {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024, // 50 MiB; work snapshots are small but Tailor configs can balloon
  });
  const rawStdout = result.stdout ?? "";
  const stdout = filterExcludedFromDiff(rawStdout);
  // After filtering, the diff may be empty even though git returned status 1.
  // Normalise to status 0 so emit* functions report "no-diff" instead of
  // writing a zero-byte diff file.
  const status = stdout.length === 0 && result.status === 1 ? 0 : result.status;
  return {
    status,
    stdout,
    stderr: result.stderr ?? "",
  };
};

export type EmitIterDiffOptions = {
  perIteration: ProblemResult[];
  runArtifactRoot: string;
  /** Override for tests. Defaults to a real `spawnSync('git', …)` call. */
  runner?: GitDiffRunner;
};

export type EmitIterDiffResult =
  | { kind: "skipped"; reason: string }
  | { kind: "no-diff" }
  | { kind: "written"; diffPath: string };

export function emitIterDiff(options: EmitIterDiffOptions): EmitIterDiffResult {
  const { perIteration, runArtifactRoot } = options;
  const runner = options.runner ?? defaultGitDiffRunner;
  if (perIteration.length < 2) {
    return { kind: "skipped", reason: "need at least 2 iterations" };
  }
  // Strict flaky check: emit only when passRate is strictly between 0 and 1.
  // - passRate === 0 (stable fail) is handled by `emitFailVsSolutionDiff`.
  // - passRate === 1 (stable pass) needs no diff — nothing flipped.
  const passedCount = perIteration.filter((r) => r.passed).length;
  const passRate = passedCount / perIteration.length;
  if (passRate <= 0 || passRate >= 1) {
    return { kind: "skipped", reason: "not flaky (all passed or all failed)" };
  }
  const passing = perIteration.find((r) => r.passed);
  const failing = perIteration.find((r) => !r.passed);
  // Both must exist because passRate is strictly in (0, 1); guard for the type
  // checker only.
  if (!passing || !failing) {
    return { kind: "skipped", reason: "not flaky (all passed or all failed)" };
  }
  const passingWork = getIterationWorkSnapshot(passing);
  const failingWork = getIterationWorkSnapshot(failing);
  if (!passingWork || !failingWork) {
    return { kind: "skipped", reason: "missing work snapshot for at least one iteration" };
  }

  const diff = runner(failingWork, passingWork);
  // git diff --no-index: 0 = no diff, 1 = diff, ≥2 = error.
  if (diff.status === 0) {
    return { kind: "no-diff" };
  }
  if (diff.status !== 1) {
    return {
      kind: "skipped",
      reason: `git diff exited with status ${diff.status ?? "<null>"}${diff.stderr ? `: ${diff.stderr.trim().split("\n")[0]}` : ""}`,
    };
  }

  // Use the first iteration's problemId for the file name; every iteration of
  // the same task has the same problemId by construction.
  const problemId = perIteration[0]!.problemId;
  const diffDir = path.join(runArtifactRoot, "iter-diff");
  fs.mkdirSync(diffDir, { recursive: true });
  const diffPath = path.join(diffDir, `${sanitizeForFilename(problemId)}.diff`);
  fs.writeFileSync(diffPath, diff.stdout);
  return { kind: "written", diffPath };
}

/**
 * Compute and persist a `git diff --no-index <scaffoldedSolution> <failingWork>`
 * for a stable-fail problem (every iteration failed verification, but the
 * solver itself completed without infra failures). Writes to
 * `<runArtifactRoot>/iter-diff/<problemId>.fail-vs-solution.diff`. No-op when:
 *
 * - any iteration passed (use `emitIterDiff` instead);
 * - every iteration is an infrastructure failure (auth / Podman / etc. —
 *   nothing actionable about the SDK affordance to surface);
 * - the first iteration has no work snapshot on disk;
 * - the reference `solution/` directory does not exist;
 * - `git diff --no-index` reports the two trees are identical (exit 0).
 *
 * Surfaces "what the agent should have done differently" without an LLM judge.
 *
 * The diff base is the reference solution **overlaid on the same scaffold
 * layers the solver saw** (`shared/scaffold` + `problems/_shared/scaffold` +
 * per-problem `scaffold/` + per-problem `solution/`). Without that scaffold
 * overlay, the raw `solution/` tree has only implementation files while the
 * solver's `work/` tree has scaffold + impl, so every scaffold file shows up as
 * "deleted" noise (70-80% of the resulting diff in production). Applying the
 * scaffold to both sides leaves only the AI's actual deviation from reference.
 */
export type EmitFailVsSolutionDiffOptions = {
  perIteration: ProblemResult[];
  problemDir: string;
  runArtifactRoot: string;
  /**
   * Additional scaffold layers to overlay onto the solution side before
   * diffing, applied in order so later layers shadow earlier ones. Defaults to
   * the same layers `setupWorkDir` uses for the solver:
   *   1. `<challengeRoot>/shared/scaffold`
   *   2. `<challengeRoot>/problems/_shared/scaffold`
   *   3. `<problemDir>/scaffold`
   * The solution layer (`<problemDir>/solution`) is always appended last.
   * Tests inject custom layers to keep the fixture self-contained.
   */
  scaffoldLayers?: readonly string[];
  /** Override for tests. Defaults to the same `spawnSync('git', …)` runner. */
  runner?: GitDiffRunner;
};

export type EmitFailVsSolutionDiffResult =
  | { kind: "skipped"; reason: string }
  | { kind: "no-diff" }
  | { kind: "written"; diffPath: string };

export function emitFailVsSolutionDiff(
  options: EmitFailVsSolutionDiffOptions,
): EmitFailVsSolutionDiffResult {
  const { perIteration, problemDir, runArtifactRoot } = options;
  const runner = options.runner ?? defaultGitDiffRunner;
  if (perIteration.length === 0) {
    return { kind: "skipped", reason: "no iterations" };
  }
  // Only stable-fail (every iteration failed verification) qualifies.
  const passedCount = perIteration.filter((r) => r.passed).length;
  if (passedCount > 0) {
    return { kind: "skipped", reason: "not stable-fail (at least one iteration passed)" };
  }
  // Skip infra failures: there is no SDK affordance signal in auth / Podman
  // failures, and the solver never produced a useful work tree to diff.
  if (perIteration.every((r) => isInfraFailure(r))) {
    return { kind: "skipped", reason: "every iteration is an infra failure" };
  }
  // Pick the first iteration whose solver completed (success or stage-fail) so
  // we diff actual agent output rather than an infra-failure stub.
  const firstUsable = perIteration.find((r) => !isInfraFailure(r));
  if (!firstUsable) {
    return { kind: "skipped", reason: "every iteration is an infra failure" };
  }
  const failingWork = getIterationWorkSnapshot(firstUsable);
  if (!failingWork) {
    return { kind: "skipped", reason: "missing work snapshot for first iteration" };
  }
  const solutionDir = path.join(problemDir, "solution");
  if (!fs.existsSync(solutionDir)) {
    return { kind: "skipped", reason: `solution dir not found: ${solutionDir}` };
  }

  // Build the diff base in a tmpdir by overlaying scaffold layers + the
  // reference solution. Without the scaffold overlay, raw solution/ is just
  // impl files while failingWork has scaffold + impl, so the diff is mostly
  // "deleted scaffold" noise rather than the AI's deviation from reference.
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fail-vs-solution-"));
  try {
    const layers = options.scaffoldLayers ?? [
      path.join(challengeRoot, "shared", "scaffold"),
      path.join(challengeRoot, "problems", "_shared", "scaffold"),
      path.join(problemDir, "scaffold"),
    ];
    applyScaffoldLayers(tmpBase, [...layers, solutionDir]);

    const diff = runner(tmpBase, failingWork);
    if (diff.status === 0) {
      return { kind: "no-diff" };
    }
    if (diff.status !== 1) {
      return {
        kind: "skipped",
        reason: `git diff exited with status ${diff.status ?? "<null>"}${diff.stderr ? `: ${diff.stderr.trim().split("\n")[0]}` : ""}`,
      };
    }

    const problemId = perIteration[0]!.problemId;
    const diffDir = path.join(runArtifactRoot, "iter-diff");
    fs.mkdirSync(diffDir, { recursive: true });
    const diffPath = path.join(diffDir, `${sanitizeForFilename(problemId)}.fail-vs-solution.diff`);
    fs.writeFileSync(diffPath, diff.stdout);
    return { kind: "written", diffPath };
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

/**
 * Decide whether to run additional iterations after the configured `iterations`
 * count has been exhausted. Returns true only for the high-variance middle band
 * (1 ≤ passedCount ≤ iterations-1) under the default iteration count when the
 * user neither pinned `--iterations` nor passed `--no-auto-extend`. Extracted
 * for unit testing the trigger conditions.
 */
export type ShouldAutoExtendOptions = {
  perIteration: ProblemResult[];
  iterations: number;
  iterationsExplicit: boolean;
  noAutoExtend: boolean;
};

export function shouldAutoExtend(options: ShouldAutoExtendOptions): boolean {
  const { perIteration, iterations, iterationsExplicit, noAutoExtend } = options;
  if (noAutoExtend) return false;
  if (iterationsExplicit) return false;
  // Only auto-extend at the default 3-iteration cadence — explicit higher
  // values already over-sample, and lower values would auto-extend to >N which
  // changes semantics in surprising ways.
  if (iterations !== 3) return false;
  if (perIteration.length !== iterations) return false;
  const passedCount = perIteration.filter((r) => r.passed).length;
  // 0/3 and 3/3 are zero-variance: more iterations cannot improve the signal.
  // 1/3 and 2/3 are the flaky middle band where two more iterations cheaply
  // disambiguate "frequently flaky" from "rarely flaky".
  return passedCount >= 1 && passedCount <= iterations - 1;
}

/**
 * Decide whether to stop the iteration loop early because the observed
 * sequence has already settled. Symmetric counterpart to
 * {@link shouldAutoExtend}; both gate on the same `iterations === 3`
 * default-cadence assumption and respect `iterationsExplicit` /
 * `noEarlyStop`.
 *
 * Two phases:
 * - `main`: applied inside the primary 0..iterations loop. Stops at n=2 when
 *   both observed iterations agree (0/2 or 2/2) — the 3rd iteration would
 *   only confirm what's already a unanimous outcome.
 * - `auto-extend`: applied during the +2 extension after the main loop hits a
 *   flaky 1/3 or 2/3. Stops at n=4 when the 4th iteration confirms the
 *   majority (3/4 or 1/4) — the 5th iteration cannot flip the majority.
 *   When the 4th iteration produces an even split (2/4) the loop continues
 *   so the 5th iteration breaks the tie.
 *
 * Extracted for unit testing the trigger conditions.
 */
export type ShouldEarlyStopOptions = {
  perIteration: ProblemResult[];
  iterations: number;
  iterationsExplicit: boolean;
  noEarlyStop: boolean;
  phase: "main" | "auto-extend";
};

export function shouldEarlyStop(options: ShouldEarlyStopOptions): boolean {
  const { perIteration, iterations, iterationsExplicit, noEarlyStop, phase } = options;
  if (noEarlyStop) return false;
  if (iterationsExplicit) return false;
  if (iterations !== 3) return false;
  const passedCount = perIteration.filter((r) => r.passed).length;
  if (phase === "main") {
    // Need exactly 2 observations: n=1 is too thin a sample to short-circuit,
    // n>=3 means the main loop has already finished its assigned iterations.
    if (perIteration.length !== 2) return false;
    return passedCount === 0 || passedCount === 2;
  }
  // auto-extend phase: the main loop produced 3 results in [1, 2] passed, then
  // we added one extra (n=4). Stop when the 4th iteration confirms the
  // majority of the original 3 (cumulative 3/4 or 1/4); continue at 2/4 so
  // the 5th iteration can break the tie.
  if (perIteration.length !== 4) return false;
  return passedCount === 1 || passedCount === 3;
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
    const tool = agent === "claude" ? "Claude Code" : agent === "oss" ? "Ollama (local)" : "Codex";
    if (authErrorPatterns.some((p) => p.test(authCheck.error ?? ""))) {
      console.error(`Please log in to ${tool} before running solve mode.`);
    } else {
      console.error(`Please check your ${tool} setup and try again.`);
    }
    if (agent === "claude") {
      console.error(
        'Hint: Run "claude setup-token" and set CLAUDE_CODE_OAUTH_TOKEN in your environment.',
      );
    } else if (agent === "oss") {
      console.error(
        "Hint: brew install ollama && ollama pull gpt-oss:20b && OLLAMA_NUM_PARALLEL=1 OLLAMA_CONTEXT_LENGTH=32768 ollama serve",
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
  runId: string = createRunId(),
): void {
  console.log("\n" + formatReportTable(report));

  const runResultsDir = getRunResultsDir(resultsDir, modelLabel);
  fs.mkdirSync(runResultsDir, { recursive: true });
  const versionLabel = sdkVersion ?? "unknown";
  const jsonPath = path.join(runResultsDir, `report-${versionLabel}-${runId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nResults written to: ${jsonPath}`);
}

function findProblem(id: string): string {
  const problems = listProblems(challengeRoot);
  const exact = problems.find((p) => p === id);
  if (exact) {
    return exact;
  }
  const prefixDash = problems.filter((p) => p.startsWith(`${id}-`));
  if (prefixDash.length === 1) {
    return prefixDash[0]!;
  }
  if (prefixDash.length > 1) {
    console.error(`Ambiguous problem ID "${id}" matches: ${prefixDash.join(", ")}`);
    process.exit(1);
  }
  const prefix = problems.filter((p) => p.startsWith(id));
  if (prefix.length === 1) {
    return prefix[0]!;
  }
  if (prefix.length > 1) {
    console.error(`Ambiguous problem ID "${id}" matches: ${prefix.join(", ")}`);
    process.exit(1);
  }
  console.error(`Problem not found: ${id}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const {
    problemIds,
    all,
    implDir,
    useSolution,
    solve,
    agent,
    model,
    maxBudget,
    clean,
    concurrency,
    contextProfile,
    iterations,
    iterationsExplicit,
    noAutoExtend,
    noEarlyStop,
    sdkBranch,
    resume: resumeRunId,
    maxBudgetTotal,
  } = parseArgs();

  if (problemIds.length === 0 && !all) {
    console.error("Usage:");
    console.error("  tsx core/cli.ts --problem 001 --impl ./path/to/impl");
    console.error("  tsx core/cli.ts --problem 001 --use-solution");
    console.error(
      "  tsx core/cli.ts --problem 001 [--problem 002 ...] --solve [--agent claude|codex|oss] [--model sonnet] [--max-budget 5.00] [--max-budget-total 50.00] [--context-profile types-only] [--iterations 3] [--no-auto-extend] [--no-early-stop] [--sdk-branch <ref>] [--resume <runId>]",
    );
    console.error("  tsx core/cli.ts --all --use-solution [--clean] [--concurrency <n>]");
    console.error(
      "  tsx core/cli.ts --all --solve [--agent claude|codex|oss] [--model sonnet] [--max-budget 5.00] [--max-budget-total 50.00] [--clean] [--concurrency <n>] [--context-profile types-only] [--iterations 3] [--no-auto-extend] [--no-early-stop] [--sdk-branch <ref>] [--resume <runId>]",
    );
    console.error("  tsx core/cli.ts --all --impl-dir ./path/to/all-outputs");
    console.error("\nNote: --solve requires Podman. On macOS, run 'podman machine start' first.");
    process.exit(1);
  }

  if (problemIds.length > 0 && all) {
    console.error("Error: --problem and --all are mutually exclusive.");
    process.exit(1);
  }
  const implModes = [solve, useSolution, implDir].filter(Boolean).length;
  if (implModes > 1) {
    console.error("Error: --solve, --use-solution, and --impl are mutually exclusive.");
    process.exit(1);
  }
  if (sdkBranch && !solve) {
    console.error(
      "Error: --sdk-branch requires --solve (only solve mode rebuilds the SDK tarball).",
    );
    process.exit(1);
  }

  const resultsDir = path.join(challengeRoot, "results");
  const verbose = concurrency === 1;
  const solveModelLabel = solve ? formatSolveModelLabel(agent, model) : undefined;

  if (solve) {
    const podmanStatus = checkPodmanAvailability();
    if (!podmanStatus.available) {
      console.error(`Error: ${podmanStatus.error}`);
      process.exit(1);
    }
  }

  if (solve) {
    await ensureAuthenticated(agent, normalizeModelForAgent(agent, model));
  }

  let tarballPath: string | undefined;
  let packDir: string | undefined;
  let worktreeDir: string | undefined;
  const cleanupPackDir = (): void => {
    if (packDir) {
      fs.rmSync(packDir, { recursive: true, force: true });
      packDir = undefined;
    }
    if (worktreeDir) {
      cleanupWorktree(sdkRepoRoot(), worktreeDir);
      worktreeDir = undefined;
    }
  };
  process.on("exit", cleanupPackDir);
  if (solve) {
    if (sdkBranch) {
      console.log(`Packing SDK tarball from branch "${sdkBranch}"...`);
      const packed = packSdkFromRef(sdkBranch);
      tarballPath = packed.tarballPath;
      packDir = packed.packDir;
      worktreeDir = packed.worktreeDir;
      console.log(`SDK tarball: ${tarballPath} (worktree: ${worktreeDir})`);
    } else {
      console.log("Packing SDK tarball...");
      const packed = packSdkTarball();
      tarballPath = packed.tarballPath;
      packDir = packed.packDir;
      console.log(`SDK tarball: ${tarballPath}`);
    }
  }

  const problems = all ? listProblems(challengeRoot) : problemIds.map((id) => findProblem(id));

  if (all) {
    console.log(`Running ${problems.length} problem(s) (concurrency: ${concurrency})...`);
  }

  const baseLabel = solve ? (solveModelLabel ?? "solve") : useSolution ? "solution" : "impl";
  // Suffix with the SDK branch (when set) so baseline vs candidate runs land in
  // distinct results subdirs and the analyze --diff mode can pick them up
  // without conflating the two histories.
  const branchSuffix = sdkBranch ? `-sdk@${sanitizeForFilename(sdkBranch)}` : "";
  const modelLabelRaw = `${baseLabel}-${contextProfile}${branchSuffix}`;

  type ProblemTask = { problemName: string; implDir?: string };
  const tasks: ProblemTask[] = [];
  for (const p of problems) {
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

  const results: ProblemResult[] = [];
  const limit = createLimiter(concurrency);
  const total = tasks.length;
  let completed = 0;
  const runStartTime = Date.now();
  const sdkVersion = getSdkVersion(challengeRoot);
  // When --resume is set, reuse the prior runId so artifact paths and
  // checkpoint file lookup line up. Otherwise mint a new one.
  const runId = resumeRunId ?? createRunId();
  const runArtifactRoot = solve
    ? createRunArtifactRoot(resultsDir, modelLabelRaw, sdkVersion, runId)
    : undefined;
  // Per-iteration checkpoint sidecar. Append after each iteration so a
  // crashed or rate-limited run can resume by re-using non-infra-failure
  // entries. Path scheme matches the final report's runResultsDir so
  // operators can find both side-by-side.
  const checkpointFile = checkpointPath(getRunResultsDir(resultsDir, modelLabelRaw), runId);
  const checkpointMap = resumeRunId
    ? groupCheckpoint(readCheckpoint(checkpointFile))
    : new Map<string, Map<number, ProblemResult>>();
  if (resumeRunId) {
    const reusable = Array.from(checkpointMap.values())
      .flatMap((m) => Array.from(m.values()))
      .filter(isCheckpointReusable).length;
    console.log(
      `Resuming runId=${resumeRunId}: ${reusable} iteration result(s) reused from ${checkpointFile}`,
    );
  }

  /**
   * Wrap `runProblem` so that rate-limit infra failures (Claude / Codex quota
   * exhaustion, HTTP 429) are retried with backoff instead of permanently
   * skipping the problem. Auth / config infra failures are NOT retried
   * because re-running them without operator intervention burns budget
   * without changing the outcome.
   *
   * Sleep strategy (in order of preference):
   * 1. If the error message carries a "resets <time>" hint that
   *    `extractRateLimitResetMs` can parse, sleep until that wall-clock
   *    moment + 30s grace.
   * 2. Otherwise, exponential-ish backoff at 60s / 120s / 300s.
   *
   * Capped at `maxAttempts` total runs (1 initial + retries) so a permanent
   * quota hit still exits in bounded time.
   */
  async function runProblemWithRateLimitRetry(args: {
    problemName: string;
    baseOptions: Parameters<typeof runProblem>[1];
    verbose: boolean;
    maxAttempts?: number;
    sleeper?: (ms: number) => Promise<void>;
    now?: () => Date;
  }): Promise<ProblemResult> {
    const maxAttempts = args.maxAttempts ?? 4;
    const sleeper = args.sleeper ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const nowFn = args.now ?? (() => new Date());
    const fixedBackoffMs = [60_000, 120_000, 300_000];
    let lastResult: ProblemResult | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await runProblem(args.problemName, args.baseOptions);
      lastResult = result;
      const solveErr = result.solveResult?.error ?? "";
      const isRateLimit = result.solveResult?.infraFailure === true && isRateLimitError(solveErr);
      if (!isRateLimit || attempt === maxAttempts - 1) {
        return result;
      }
      const now = nowFn();
      const resetMs = extractRateLimitResetMs(solveErr, now);
      const sleepMs =
        resetMs !== null
          ? Math.max(0, resetMs - now.getTime()) + 30_000
          : (fixedBackoffMs[attempt] ?? fixedBackoffMs.at(-1)!);
      if (args.verbose) {
        const reason = resetMs !== null ? `reset hint +30s` : `backoff #${attempt + 1}`;
        console.log(
          `  rate-limit on ${args.problemName} — sleeping ${Math.round(sleepMs / 1000)}s (${reason}) before retry`,
        );
      }
      await sleeper(sleepMs);
    }
    // Unreachable in practice (the for loop returns on the last attempt) but
    // narrows the type for TS.
    return lastResult!;
  }

  /**
   * Run a single problem `iterations` times sequentially (inside the
   * concurrency slot so we do not multiply Podman load by N). Returns the
   * aggregated `ProblemResult` — when iterations == 1 this is the raw single
   * result; when > 1 the `iterations` field carries variance bounds.
   *
   * Iterations are sequential within a slot because:
   * 1. Running N parallel solves of the same problem multiplies podman load.
   * 2. The artifact directory layout uses per-iteration suffixes; doing them
   *    in order lets us write `iter-1`, `iter-2`, ... predictably.
   */
  async function runProblemWithIterations(task: ProblemTask): Promise<ProblemResult> {
    const baseOptions = {
      implDir: task.implDir,
      solve: solve ? { agent, model, maxBudget } : undefined,
      clean,
      verbose,
      tarballPath,
      contextProfile,
    } as const;
    if (iterations === 1) {
      // Single-iteration shortcut: still honour the checkpoint, so a resume
      // of a non-iteration run can reuse a prior pass result.
      const cached = checkpointMap.get(task.problemName)?.get(0);
      if (cached && isCheckpointReusable(cached)) {
        if (verbose) {
          console.log(`  resume: reusing iter-0 result for ${task.problemName} from checkpoint`);
        }
        return cached;
      }
      const result = await runProblemWithRateLimitRetry({
        problemName: task.problemName,
        baseOptions: {
          ...baseOptions,
          solve: baseOptions.solve ? { ...baseOptions.solve, seed: 0 } : undefined,
          runArtifactRoot,
        },
        verbose,
      });
      appendCheckpoint(checkpointFile, {
        problemName: task.problemName,
        iter: 0,
        result,
      });
      return result;
    }
    const perIteration: ProblemResult[] = [];
    const runOneIteration = async (i: number): Promise<void> => {
      // Reuse a prior non-infra checkpoint entry for the same (problem, iter)
      // pair when resuming. Re-run otherwise.
      const cached = checkpointMap.get(task.problemName)?.get(i);
      if (cached && isCheckpointReusable(cached)) {
        if (verbose) {
          console.log(`  resume: reusing iter-${i} result for ${task.problemName} from checkpoint`);
        }
        perIteration.push(cached);
        return;
      }
      // Place each iteration's artifact under a sub-dir so the trace.jsonl /
      // workSnapshot of iter-1 isn't overwritten by iter-2.
      const iterRoot = runArtifactRoot ? path.join(runArtifactRoot, `iter-${i}`) : undefined;
      // Wrap runProblem in a rate-limit retry: when the agent returns an
      // infra-failure caused by rate-limit / 429 / quota, sleep and try
      // again. Cap retries so a permanent quota hit can still exit.
      const result = await runProblemWithRateLimitRetry({
        problemName: task.problemName,
        baseOptions: {
          ...baseOptions,
          solve: baseOptions.solve ? { ...baseOptions.solve, seed: i } : undefined,
          ...(iterRoot ? { runArtifactRoot: iterRoot } : {}),
        },
        verbose,
      });
      appendCheckpoint(checkpointFile, {
        problemName: task.problemName,
        iter: i,
        result,
      });
      perIteration.push(result);
    };
    for (let i = 0; i < iterations; i++) {
      await runOneIteration(i);
      // Agreement-based early stop: when the first two iterations of the
      // default N=3 cadence agree (0/2 or 2/2), the 3rd iteration only
      // confirms a unanimous outcome. Skipping it reclaims ~25% of solve
      // cost on stable_pass / stable_fail problems without changing the
      // passRate the report ultimately records.
      if (
        shouldEarlyStop({
          perIteration,
          iterations,
          iterationsExplicit,
          noEarlyStop,
          phase: "main",
        })
      ) {
        if (verbose) {
          console.log(
            `  early-stop: ${perIteration.filter((r) => r.passed).length}/${perIteration.length} → skipping remaining iteration(s)`,
          );
        }
        break;
      }
    }

    // Flaky middle-band auto-extend: with the default N=3, a 1/3 or 2/3 outcome
    // is the high-signal but high-noise zone. Run two more iterations to reach
    // an N=5 sample so the passRate signal stabilises. Skip when the user set
    // `--iterations` explicitly or passed `--no-auto-extend`.
    if (shouldAutoExtend({ perIteration, iterations, iterationsExplicit, noAutoExtend })) {
      const extra = 2;
      if (verbose) {
        console.log(
          `  auto-extend: ${perIteration.filter((r) => r.passed).length}/${iterations} → running ${extra} more iteration(s)`,
        );
      }
      for (let i = iterations; i < iterations + extra; i++) {
        await runOneIteration(i);
        // Mid-extension early stop: once n=4 confirms the original majority
        // (cumulative 3/4 or 1/4), the 5th iteration cannot flip the
        // majority. A 2/4 split keeps running so iteration 5 breaks the tie.
        if (
          shouldEarlyStop({
            perIteration,
            iterations,
            iterationsExplicit,
            noEarlyStop,
            phase: "auto-extend",
          })
        ) {
          if (verbose) {
            console.log(
              `  early-stop (auto-extend): ${perIteration.filter((r) => r.passed).length}/${perIteration.length} → skipping remaining iteration(s)`,
            );
          }
          break;
        }
      }
    }

    // When the problem is partially passing (flaky), capture the file-system
    // delta between the first failing iteration's work tree and the first
    // passing one. This is the post-Phase-5a replacement for the affordance
    // judge: surface the *actual* code change that flipped the outcome, so
    // operators can read it directly without an LLM intermediary.
    if (runArtifactRoot) {
      try {
        const outcome = emitIterDiff({ perIteration, runArtifactRoot });
        if (verbose && outcome.kind === "written") {
          console.log(`  iter-diff: ${path.relative(runArtifactRoot, outcome.diffPath)}`);
        }
      } catch (err) {
        // Diagnostic only — never let an emitter failure mask the actual
        // benchmark result.
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  iter-diff emit failed: ${msg}`);
      }
      // For stable-fail (every iteration failed verify but solver completed),
      // surface the delta against the reference `solution/` so an operator can
      // read "what the agent should have produced" without invoking an LLM
      // judge.
      try {
        const problemDir = path.join(challengeRoot, "problems", task.problemName);
        const outcome = emitFailVsSolutionDiff({
          perIteration,
          problemDir,
          runArtifactRoot,
        });
        if (verbose && outcome.kind === "written") {
          console.log(`  fail-vs-solution: ${path.relative(runArtifactRoot, outcome.diffPath)}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  fail-vs-solution emit failed: ${msg}`);
      }
    }

    return aggregateIterations(perIteration);
  }

  // Aggregate cost across all completed problems. Compared against
  // `maxBudgetTotal` at each task's slot-open moment so a single overrun
  // problem can still finish — only subsequent tasks see the cap. costUsd
  // from the aggregated `solveResult` for iteration runs is the sum across
  // all iterations of that problem (set by aggregateIterations).
  let totalSpentUsd = 0;
  const budgetExceededResult = (taskName: string): ProblemResult => {
    const problemDir = path.join(challengeRoot, "problems", taskName);
    const meta = loadMeta(problemDir);
    return {
      problemId: meta.id,
      problemName: deriveProblemName(meta, taskName),
      difficulty: meta.difficulty ?? "easy",
      category: meta.category ?? meta.sdkSurface ?? "micro",
      ...(meta.split !== undefined ? { split: meta.split } : {}),
      contextProfile,
      stages: makeSkippedStages("budget exceeded"),
      passed: false,
      solveResult: {
        success: false,
        costUsd: 0,
        durationMs: 0,
        output: "",
        error: `budget_exceeded: totalSpentUsd=${totalSpentUsd.toFixed(4)} >= --max-budget-total=${maxBudgetTotal}`,
        infraFailure: true,
      },
      totalDurationMs: 0,
    };
  };

  await Promise.all(
    tasks.map((task) =>
      limit(async () => {
        try {
          if (maxBudgetTotal !== undefined && totalSpentUsd >= maxBudgetTotal) {
            const skipped = budgetExceededResult(task.problemName);
            results.push(skipped);
            completed++;
            if (!verbose) {
              console.log(
                `[${completed}/${total}] ${task.problemName}: BUDGET_EXCEEDED (spent $${totalSpentUsd.toFixed(2)})`,
              );
            }
            return;
          }

          const result = await runProblemWithIterations(task);

          results.push(result);
          completed++;
          totalSpentUsd += result.solveResult?.costUsd ?? 0;

          if (!verbose) {
            let status: string;
            if (result.iterations) {
              status = `${result.iterations.passedCount}/${result.iterations.count} passed`;
            } else if (result.passed) {
              status = "PASS";
            } else {
              status = "FAIL";
            }
            console.log(
              `[${completed}/${total}] ${task.problemName}: ${status} [${formatDuration(result.totalDurationMs ?? 0)}]`,
            );
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] ${task.problemName}: ${errorMsg}`);

          const problemDir = path.join(challengeRoot, "problems", task.problemName);
          const meta = loadMeta(problemDir);
          const stages = makeSkippedStages(`runner error: ${errorMsg}`);
          results.push({
            problemId: meta.id,
            problemName: deriveProblemName(meta, task.problemName),
            difficulty: meta.difficulty ?? "easy",
            category: meta.category ?? meta.sdkSurface ?? "micro",
            ...(meta.split !== undefined ? { split: meta.split } : {}),
            contextProfile,
            stages,
            passed: false,
            totalDurationMs: 0,
          });
          completed++;
        }
      }),
    ),
  );

  results.sort((a, b) => a.problemId.localeCompare(b.problemId));

  const report = createReport(results, {
    model: solveModelLabel,
    contextProfile,
    sdkVersion,
    elapsedMs: Date.now() - runStartTime,
    ...(sdkBranch ? { sdkBranch } : {}),
    iterationCount: iterations,
  });

  writeReport(resultsDir, report, modelLabelRaw, sdkVersion, runId);
  // Once the final report exists, the checkpoint is redundant. Best-effort
  // delete so the runResultsDir does not accumulate dead JSONL files. A
  // future resume into the same runId would now see no checkpoint and
  // re-run from scratch — but that is by design (final report present means
  // the run completed).
  deleteCheckpoint(checkpointFile);
}

// Only auto-run when invoked directly via `tsx core/cli.ts` etc., so importing
// from tests (vitest) does not kick off the full challenge runner.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
