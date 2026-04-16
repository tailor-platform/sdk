import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";

/**
 * Options for running a command subprocess
 */
export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** When true, non-zero exit codes resolve instead of throwing. */
  allowFail?: boolean;
}

/**
 * Result of running a command subprocess
 */
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RunCommandArgs {
  command: string;
  args: string[];
  options?: RunOptions;
}

function runCommand({ command, args, options }: RunCommandArgs): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !options?.allowFail) {
        const message = `${command} ${args.join(" ")} failed with exit code ${exitCode}: ${stderr.trim() || stdout.trim()}`;
        reject(new Error(message));
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}

/**
 * Run a `git` subprocess and collect stdout/stderr.
 * @param args - Arguments passed to `git`
 * @param options - Run options (cwd, env, allowFail)
 * @returns stdout, stderr, and exit code
 */
export function runGit(args: string[], options?: RunOptions): Promise<RunResult> {
  return runCommand({ command: "git", args, options });
}

function runGh(args: string[], options?: RunOptions): Promise<RunResult> {
  return runCommand({ command: "gh", args, options });
}

/**
 * Return the absolute path of the git repository top level.
 * @param cwd - Working directory to resolve from
 * @returns Absolute path to the repository root
 */
export async function gitTopLevel(cwd?: string): Promise<string> {
  const result = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  return result.stdout.trim();
}

/**
 * Return the current branch name, or `null` when HEAD is detached.
 * @param cwd - Working directory to resolve from
 * @returns Branch name or null
 */
export async function currentBranch(cwd?: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const name = result.stdout.trim();
  if (!name || name === "HEAD") return null;
  return name;
}

/**
 * Resolve a ref to its full 40-character SHA.
 * @param ref - A git ref, SHA, or symbolic name
 * @param cwd - Working directory to resolve from
 * @returns Full SHA
 */
export async function revParse(ref: string, cwd?: string): Promise<string> {
  const result = await runGit(["rev-parse", ref], { cwd });
  return result.stdout.trim();
}

/**
 * Dependencies for `detectBaseRef`, allowing the gh/git calls to be stubbed in tests.
 */
export interface DetectBaseRefDeps {
  cwd?: string;
  runGh?: (args: string[], options?: RunOptions) => Promise<RunResult>;
  runGitCmd?: (args: string[], options?: RunOptions) => Promise<RunResult>;
}

/**
 * Detect the base ref for the current branch.
 * Tries `gh pr view` first, then falls back to `origin/HEAD` symbolic ref.
 * @param deps - Optional command runners for testability and the working directory
 * @returns A ref name like `origin/main`, or `null` when detection fails
 */
export async function detectBaseRef(deps?: DetectBaseRefDeps): Promise<string | null> {
  const runGhFn = deps?.runGh ?? ((args, options) => runGh(args, { ...options, allowFail: true }));
  const runGitFn =
    deps?.runGitCmd ?? ((args, options) => runGit(args, { ...options, allowFail: true }));

  const ghResult = await runGhFn(["pr", "view", "--json", "baseRefName", "-q", ".baseRefName"], {
    cwd: deps?.cwd,
    allowFail: true,
  });
  if (ghResult.exitCode === 0) {
    const branch = ghResult.stdout.trim();
    if (branch) return `origin/${branch}`;
  }

  const symRef = await runGitFn(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
    cwd: deps?.cwd,
    allowFail: true,
  });
  if (symRef.exitCode === 0) {
    const ref = symRef.stdout.trim();
    if (ref) return ref;
  }

  return null;
}

/**
 * Options for preparing a merge worktree
 */
export interface PrepareMergeWorktreeOptions {
  repoRoot: string;
  baseRef: string;
  /** Ref to merge into the base. Defaults to `HEAD`. */
  headRef?: string;
  /** Prefix for the temporary directory name. Defaults to `tailor-sdk-plan-`. */
  tmpDirPrefix?: string;
}

/**
 * Handle for a prepared merge worktree.
 */
export interface PreparedMergeWorktree {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Resolved SHA of the base ref. */
  baseRef: string;
  /** Resolved SHA of the merged head ref. */
  headRef: string;
  /** Remove the worktree and temporary directory. Safe to call multiple times. */
  dispose(): Promise<void>;
}

/**
 * Prepare a throwaway git worktree at `baseRef` with `headRef` merged into it.
 * The working tree reflects the post-merge state; no commit is created.
 * @param options - Repository root, refs, and tmp dir prefix
 * @returns A handle with the worktree path, resolved refs, and a dispose callback
 */
export async function prepareMergeWorktree(
  options: PrepareMergeWorktreeOptions,
): Promise<PreparedMergeWorktree> {
  const { repoRoot, baseRef, headRef = "HEAD", tmpDirPrefix = "tailor-sdk-plan-" } = options;

  const [resolvedBase, resolvedHead] = await Promise.all([
    revParse(baseRef, repoRoot),
    revParse(headRef, repoRoot),
  ]);

  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), tmpDirPrefix));
  let worktreeRegistered = false;
  try {
    await runGit(["worktree", "add", "--detach", worktreePath, resolvedBase], { cwd: repoRoot });
    worktreeRegistered = true;

    const mergeEnv: NodeJS.ProcessEnv = { ...process.env, GIT_MERGE_AUTOEDIT: "no" };
    const mergeResult = await runGit(
      ["-c", "core.hooksPath=/dev/null", "merge", "--no-commit", "--no-ff", resolvedHead],
      { cwd: worktreePath, env: mergeEnv, allowFail: true },
    );
    if (mergeResult.exitCode !== 0) {
      const status = await runGit(["status", "--porcelain"], {
        cwd: worktreePath,
        allowFail: true,
      });
      const conflictLines = status.stdout
        .split("\n")
        .filter((line) => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(line))
        .map((line) => line.slice(3));
      const detail =
        conflictLines.length > 0
          ? ` Conflicting paths: ${conflictLines.join(", ")}`
          : " See git output for details.";
      throw new Error(
        `Merge conflict while merging ${headRef} into ${baseRef}.${detail} ${mergeResult.stderr.trim()}`.trim(),
      );
    }
  } catch (err) {
    await cleanupWorktree({ repoRoot, worktreePath, registered: worktreeRegistered });
    throw err;
  }

  let disposed = false;
  return {
    path: worktreePath,
    baseRef: resolvedBase,
    headRef: resolvedHead,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await cleanupWorktree({ repoRoot, worktreePath, registered: true });
    },
  };
}

interface CleanupArgs {
  repoRoot: string;
  worktreePath: string;
  registered: boolean;
}

async function cleanupWorktree({ repoRoot, worktreePath, registered }: CleanupArgs): Promise<void> {
  if (registered) {
    await runGit(["worktree", "remove", "--force", worktreePath], {
      cwd: repoRoot,
      allowFail: true,
    });
  }
  fs.rmSync(worktreePath, { recursive: true, force: true });
}
