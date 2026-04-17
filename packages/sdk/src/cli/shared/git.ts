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
    child.on("error", (err) => {
      if (options?.allowFail) {
        resolve({ stdout: "", stderr: err.message, exitCode: 127 });
        return;
      }
      reject(err);
    });
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
  /** Env used to read CI metadata like `GITHUB_BASE_REF`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Detect the base ref for the current branch.
 * Checks CI metadata (`GITHUB_BASE_REF`) first so detached-HEAD pull_request
 * checkouts target the real PR base, then tries `gh pr view`, and finally
 * falls back to `origin/HEAD`.
 * @param deps - Optional command runners for testability and the working directory
 * @returns A ref name like `origin/main`, or `null` when detection fails
 */
export async function detectBaseRef(deps?: DetectBaseRefDeps): Promise<string | null> {
  const env = deps?.env ?? process.env;
  const runGhFn = deps?.runGh ?? ((args, options) => runGh(args, { ...options, allowFail: true }));
  const runGitFn =
    deps?.runGitCmd ?? ((args, options) => runGit(args, { ...options, allowFail: true }));

  const ciBase = env.GITHUB_BASE_REF?.trim();
  if (ciBase) {
    // Fork-style pull_request checkouts can point `origin` at the contributor
    // fork, which would make `origin/<base>` resolve to the fork's branch
    // instead of the PR's real base. Use GITHUB_REPOSITORY to match the
    // base-repo remote, mirroring the gh path.
    const baseRepoUrl = buildGithubRepoUrl(env.GITHUB_SERVER_URL, env.GITHUB_REPOSITORY);
    const remote = await resolveBaseRemote({ baseRepoUrl, cwd: deps?.cwd, runGitFn });
    const ref = `${remote}/${ciBase}`;
    const verify = await runGitFn(["rev-parse", "--verify", "--quiet", ref], {
      cwd: deps?.cwd,
      allowFail: true,
    });
    if (verify.exitCode === 0) return ref;
    // GITHUB_BASE_REF is authoritative — falling back to gh or origin/HEAD
    // would silently plan against a different base. Surface a clear error
    // so CI can fetch the base ref (e.g. `fetch-depth: 0`) and retry.
    throw new Error(
      `GITHUB_BASE_REF is "${ciBase}" but ${ref} is not available locally. ` +
        `The PR checkout is likely shallow; fetch the base branch (e.g. ` +
        `configure actions/checkout with \`fetch-depth: 0\` or run ` +
        `\`git fetch ${remote} ${ciBase}\`) and retry.`,
    );
  }

  const ghResult = await runGhFn(["pr", "view", "--json", "baseRefName,url"], {
    cwd: deps?.cwd,
    allowFail: true,
  });
  if (ghResult.exitCode === 0) {
    const parsed = parseGhPrView(ghResult.stdout);
    if (parsed?.baseRefName) {
      // Fork-style clones route the PR against an upstream remote that is not
      // called `origin`. Pick the remote whose URL matches the PR's base repo
      // URL so `--base` plans against the real PR base rather than the
      // contributor's fork mirror. Fall back to `origin` when no remote
      // matches, matching historical behavior.
      const remote = await resolveBaseRemote({
        baseRepoUrl: extractBaseRepoUrl(parsed.url),
        cwd: deps?.cwd,
        runGitFn,
      });
      const ref = `${remote}/${parsed.baseRefName}`;
      const verify = await runGitFn(["rev-parse", "--verify", "--quiet", ref], {
        cwd: deps?.cwd,
        allowFail: true,
      });
      if (verify.exitCode === 0) return ref;
      // gh reported an authoritative PR base. Falling back to origin/HEAD
      // would silently plan against the default branch instead, so surface
      // a clear error telling the caller to fetch the missing ref.
      throw new Error(
        `gh reported PR base "${parsed.baseRefName}" but ${ref} is not available locally. ` +
          `Fetch it (e.g. \`git fetch ${remote} ${parsed.baseRefName}\`) and retry.`,
      );
    }
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

interface GhPrView {
  baseRefName?: string;
  url?: string;
}

function parseGhPrView(stdout: string): GhPrView | null {
  try {
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    const baseRefName = typeof raw.baseRefName === "string" ? raw.baseRefName.trim() : undefined;
    const url = typeof raw.url === "string" ? raw.url : undefined;
    return { baseRefName: baseRefName || undefined, url };
  } catch {
    return null;
  }
}

interface ResolveBaseRemoteArgs {
  baseRepoUrl: string | null;
  cwd: string | undefined;
  runGitFn: (args: string[], options?: RunOptions) => Promise<RunResult>;
}

async function resolveBaseRemote(args: ResolveBaseRemoteArgs): Promise<string> {
  const { baseRepoUrl, cwd, runGitFn } = args;
  if (!baseRepoUrl) return "origin";
  const remotes = await runGitFn(["remote", "-v"], { cwd, allowFail: true });
  if (remotes.exitCode !== 0) return "origin";
  const wanted = normalizeGitRepoUrl(baseRepoUrl);
  for (const line of remotes.stdout.split("\n")) {
    if (!line.includes("(fetch)")) continue;
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line);
    if (!match) continue;
    const [, name, url] = match;
    if (normalizeGitRepoUrl(url) === wanted) return name;
  }
  return "origin";
}

function extractBaseRepoUrl(prUrl: string | undefined): string | null {
  if (!prUrl) return null;
  // PR URL format: https://<host>/<owner>/<repo>/pull/<n>. Strip /pull/... to
  // get the base repo URL.
  const match = /^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/\d+/.exec(prUrl);
  return match ? match[1] : null;
}

function buildGithubRepoUrl(
  serverUrl: string | undefined,
  repository: string | undefined,
): string | null {
  const repo = repository?.trim();
  if (!repo) return null;
  const server = serverUrl?.trim() || "https://github.com";
  return `${server.replace(/\/+$/, "")}/${repo}`;
}

function normalizeGitRepoUrl(url: string): string {
  // Normalize https, ssh, and git@ forms so fetch URLs compare equal.
  // https://github.com/owner/repo.git -> github.com/owner/repo
  // git@github.com:owner/repo.git     -> github.com/owner/repo
  // ssh://git@github.com/owner/repo   -> github.com/owner/repo
  return url
    .trim()
    .replace(/\.git$/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\/(?:[^@]+@)?/, "")
    .replace(/^git@([^:]+):/, "$1/")
    .toLowerCase();
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
