import { spawnSync } from "node:child_process";
import { type Repository, toRepository } from "./git";

export type GhOutput = { status: number; stdout: string; stderr: string };

/**
 * Runs a gh command.
 * @param args - Arguments passed to `gh`
 * @param cwd - Working directory to run gh in
 * @returns Exit status and output, or null when gh is not installed
 */
export type GhRunner = (args: string[], cwd: string) => GhOutput | null;

const GH_TIMEOUT_MS = 60_000;

export const defaultGhRunner: GhRunner = (args, cwd) => {
  const result = spawnSync("gh", args, { cwd, encoding: "utf-8", timeout: GH_TIMEOUT_MS });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr || result.error?.message || "",
  };
};

/** Arguments that make gh print the repository it resolves for the current directory. */
export const REPO_VIEW_ARGS = ["repo", "view", "--json", "nameWithOwner,url"];

/**
 * Read the repository from the output of gh run with `REPO_VIEW_ARGS`.
 * @param stdout - Standard output of gh
 * @returns The repository, or null when the output does not name one safe to embed in commands
 */
export function parseRepoView(stdout: string): Repository | null {
  try {
    const { nameWithOwner, url } = JSON.parse(stdout) as { nameWithOwner: string; url: string };
    const [owner = "", name = "", ...rest] = nameWithOwner.split("/");
    if (rest.length > 0) return null;
    return toRepository(owner, name, new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Ask gh which repository a directory belongs to, the way gh resolves it for its own commands.
 * @param cwd - Directory to ask about
 * @param run - gh runner
 * @returns The repository, or null when gh is not installed, fails, or names an unusable one
 */
export function viewRepository(cwd: string, run: GhRunner = defaultGhRunner): Repository | null {
  const result = run(REPO_VIEW_ARGS, cwd);
  return result?.status === 0 ? parseRepoView(result.stdout) : null;
}
