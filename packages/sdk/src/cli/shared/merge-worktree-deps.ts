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
const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"];

/**
 * Link node_modules directories from `sourceRoot` into the matching locations
 * under `targetRoot`. Aborts without touching the target if any supported
 * lockfile or the root `package.json` differs between source and target,
 * since that signals a dependency change requiring a fresh install.
 *
 * Each target `node_modules` is created as a real directory and its top-level
 * entries are linked from the source. Symlinks are recreated verbatim so
 * relative workspace links (e.g. `../packages/foo`) resolve inside the target
 * worktree instead of leaking back to the source checkout.
 * @param options - Source and target worktree roots
 * @returns Result describing whether links were created or why the operation aborted
 */
export function linkNodeModules(options: LinkNodeModulesOptions): LinkNodeModulesResult {
  const { sourceRoot, targetRoot } = options;

  for (const lockfile of LOCKFILES) {
    if (filesDiffer(sourceRoot, targetRoot, lockfile)) {
      return {
        method: "abort",
        reason: `${lockfile} differs between source and merge target; reinstall dependencies first.`,
        created: [],
      };
    }
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

    fs.rmSync(targetPath, { recursive: true, force: true });
    populateNodeModules(sourcePath, targetPath);
    created.push(targetPath);
  }

  return { method: "symlink", created };
}

function populateNodeModules(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const srcEntry = path.join(sourceDir, entry.name);
    const tgtEntry = path.join(targetDir, entry.name);
    if (entry.isSymbolicLink()) {
      // Recreate the symlink verbatim. Relative links like `../packages/foo`
      // then resolve inside `targetDir`, pointing to the merged worktree copy.
      fs.symlinkSync(fs.readlinkSync(srcEntry), tgtEntry);
    } else {
      fs.symlinkSync(srcEntry, tgtEntry, entry.isDirectory() ? "dir" : "file");
    }
  }
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
