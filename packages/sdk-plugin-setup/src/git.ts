import { spawnSync } from "node:child_process";

/**
 * Runs a git command and returns its trimmed stdout, or null on failure.
 * Injectable so callers (and tests) can substitute the git runner.
 * @param args - Arguments passed to `git`
 * @param cwd - Working directory to run git in
 * @returns Trimmed stdout, or null when git is unavailable or exits non-zero
 */
export type GitRunner = (args: string[], cwd: string) => string | null;

const defaultGitRunner: GitRunner = (args, cwd) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return null;
  }
  return result.stdout.trim();
};

/**
 * Detect the remote default branch by reading `refs/remotes/origin/HEAD`.
 *
 * Throws an AI-first error (with a remediation hint) when the symbolic ref is
 * not set, so the caller can surface a clear next step instead of a silent
 * fallback.
 * @param cwd - Repository directory to inspect
 * @param run - Git runner, injectable for testing
 * @param branchFlag - Flag name to suggest in the remediation hint
 * @returns The default branch name (e.g. `main`)
 */
export function detectDefaultBranch(
  cwd: string,
  run: GitRunner = defaultGitRunner,
  branchFlag = "--branch",
): string {
  const ref = run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
  const branch = ref?.startsWith("origin/") ? ref.slice("origin/".length) : ref;
  if (!branch) {
    throw new Error(
      "Could not detect the default branch from git. " +
        `Pass ${branchFlag} <name>, or run 'git remote set-head origin --auto' to record it.`,
    );
  }
  return branch;
}

export type Repository = { owner: string; name: string };

const GITHUB_REMOTE_RE =
  /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/;
const REPOSITORY_PART_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Detect the GitHub repository from the `origin` remote URL.
 * @param cwd - Repository directory to inspect
 * @param run - Git runner, injectable for testing
 * @returns Owner and name, or null when origin is missing, not on github.com, or unsafe to embed
 */
export function detectRepository(
  cwd: string,
  run: GitRunner = defaultGitRunner,
): Repository | null {
  const match = run(["remote", "get-url", "origin"], cwd)?.match(GITHUB_REMOTE_RE);
  if (!match) return null;
  const [, owner = "", name = ""] = match;
  if (!REPOSITORY_PART_RE.test(owner) || !REPOSITORY_PART_RE.test(name)) return null;
  return { owner, name };
}
