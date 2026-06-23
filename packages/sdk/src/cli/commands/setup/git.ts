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
 * @returns The default branch name (e.g. `main`)
 */
export function detectDefaultBranch(cwd: string, run: GitRunner = defaultGitRunner): string {
  const ref = run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
  const branch = ref?.startsWith("origin/") ? ref.slice("origin/".length) : ref;
  if (!branch) {
    throw new Error(
      "Could not detect the default branch from git. " +
        "Pass --branch <name>, or run 'git remote set-head origin --auto' to record it.",
    );
  }
  return branch;
}
