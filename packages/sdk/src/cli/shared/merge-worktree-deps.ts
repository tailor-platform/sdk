import * as fs from "node:fs";
import * as path from "pathe";
import { hashFile } from "@/cli/cache/hasher";

/**
 * Result of attempting to populate node_modules in a merge worktree.
 */
export interface LinkNodeModulesResult {
  /** `"symlink"` when deps were linked, `"abort"` when skipped with a reason. */
  method: "symlink" | "abort";
  /** Populated when `method` is `"abort"`. */
  reason?: string;
  /** Absolute paths of symlinks created (or that already existed as symlinks). */
  created: string[];
}

/**
 * Options for linking node_modules from a source repo into a target worktree.
 */
export interface LinkNodeModulesOptions {
  sourceRoot: string;
  targetRoot: string;
}

const MAX_DEPTH = 6;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * Link node_modules directories from `sourceRoot` into the matching locations
 * under `targetRoot`. Aborts without touching the target if the root
 * `pnpm-lock.yaml` or `package.json` differs between source and target, since
 * that signals a dependency change requiring a fresh install.
 * @param options - Source and target worktree roots
 * @returns Result describing whether links were created or why the operation aborted
 */
export function linkNodeModules(options: LinkNodeModulesOptions): LinkNodeModulesResult {
  const { sourceRoot, targetRoot } = options;

  if (filesDiffer(sourceRoot, targetRoot, "pnpm-lock.yaml")) {
    return {
      method: "abort",
      reason: "pnpm-lock.yaml differs between source and merge target; run `pnpm install` first.",
      created: [],
    };
  }

  if (filesDiffer(sourceRoot, targetRoot, "package.json")) {
    return {
      method: "abort",
      reason:
        "Root package.json differs between source and merge target; dependencies may need to be reinstalled.",
      created: [],
    };
  }

  const nodeModulesDirs = findNodeModulesDirs(sourceRoot);
  const created: string[] = [];
  for (const rel of nodeModulesDirs) {
    const sourcePath = path.join(sourceRoot, rel);
    const targetPath = path.join(targetRoot, rel);
    const parent = path.dirname(targetPath);
    if (!fs.existsSync(parent)) continue;

    if (fs.existsSync(targetPath)) {
      if (fs.lstatSync(targetPath).isSymbolicLink()) {
        created.push(targetPath);
        continue;
      }
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    fs.symlinkSync(sourcePath, targetPath, "dir");
    created.push(targetPath);
  }

  return { method: "symlink", created };
}

function filesDiffer(sourceRoot: string, targetRoot: string, rel: string): boolean {
  const sourcePath = path.join(sourceRoot, rel);
  const targetPath = path.join(targetRoot, rel);
  const sourceExists = fs.existsSync(sourcePath);
  const targetExists = fs.existsSync(targetPath);
  if (!sourceExists && !targetExists) return false;
  if (sourceExists !== targetExists) return true;
  return hashFile(sourcePath) !== hashFile(targetPath);
}

function findNodeModulesDirs(root: string): string[] {
  const results: string[] = [];
  walk(root, root, 0, results);
  return results;
}

function walk(root: string, dir: string, depth: number, results: string[]): void {
  if (depth > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Skip unreadable directories (permission denied, broken symlinks).
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules") {
      results.push(path.relative(root, path.join(dir, entry.name)));
      continue;
    }
    if (SKIP_DIRS.has(entry.name)) continue;
    walk(root, path.join(dir, entry.name), depth + 1, results);
  }
}
