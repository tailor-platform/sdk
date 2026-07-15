import { promises as fs } from "node:fs";
import path from "node:path";
import { toPosix } from "./utils";

const EXCLUDED_DIRS = new Set([
  ".challenge",
  ".git",
  ".pnpm-store",
  ".pnpm-home",
  ".cache",
  ".turbo",
  "node_modules",
]);
const EXCLUDED_PATHS = new Set([".tailor-sdk/cache"]);

export function isExcludedWorkspacePath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) {
    return true;
  }
  for (const excludedPath of EXCLUDED_PATHS) {
    if (relativePath === excludedPath || relativePath.startsWith(`${excludedPath}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively list workspace files as posix-style paths relative to
 * `worktreePath`, skipping challenge-internal and generated directories so the
 * artifact summary and verification agree on what the solver produced.
 */
export async function listWorkspaceFiles(worktreePath: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosix(path.relative(worktreePath, absolutePath));
      if (entry.isDirectory()) {
        if (isExcludedWorkspacePath(relativePath)) {
          continue;
        }
        await walk(absolutePath);
      } else {
        files.push(relativePath);
      }
    }
  }
  await walk(worktreePath);
  return files.toSorted();
}
