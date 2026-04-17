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
// Directories excluded when comparing workspace-package contents for the
// source-fallback safety check: `node_modules` is just linked deps, `.git`
// is metadata, and the rest are conventional build-output locations whose
// mismatch is expected (the whole point of the fallback is that dist/ is
// absent in the merged worktree).
const PACKAGE_ARTIFACT_DIRS = new Set(["node_modules", ".git", "dist", "build", "lib", "out"]);

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

  const nodeModulesDirs = findNodeModulesDirs(sourceRoot);

  // Verify manifests match at the repo root plus each node_modules' parent
  // directory. Nested workspaces (e.g. `apps/foo/package-lock.json`) can
  // change independently of the repo root, so a root-only check would
  // silently link stale deps into the merged tree.
  const parentsToCheck = new Set<string>(["."]);
  for (const rel of nodeModulesDirs) {
    parentsToCheck.add(path.dirname(rel));
  }
  for (const parentRel of parentsToCheck) {
    const targetParent = path.join(targetRoot, parentRel);
    if (!fs.existsSync(targetParent)) continue;
    const mismatch = findManifestMismatch(sourceRoot, targetRoot, parentRel);
    if (mismatch) {
      return { method: "abort", reason: mismatch, created: [] };
    }
  }

  // Pre-scan workspace symlinks before populating. If any relative link points
  // at a merged-tree package missing its entrypoints AND that package's source
  // content diverged from the merged tree, the source artifacts would
  // misrepresent the merged state. Abort instead of silently mixing trees.
  for (const rel of nodeModulesDirs) {
    const sourceNm = path.join(sourceRoot, rel);
    const targetParent = path.join(targetRoot, path.dirname(rel));
    if (!fs.existsSync(targetParent)) continue;
    const workspaceMismatch = findWorkspaceMismatch(sourceNm, path.join(targetRoot, rel));
    if (workspaceMismatch) {
      return { method: "abort", reason: workspaceMismatch, created: [] };
    }
  }

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

function findManifestMismatch(
  sourceRoot: string,
  targetRoot: string,
  parentRel: string,
): string | null {
  for (const lockfile of LOCKFILES) {
    const lockRel = path.join(parentRel, lockfile);
    if (filesDiffer(sourceRoot, targetRoot, lockRel)) {
      return `${lockRel} differs between source and merge target; reinstall dependencies first.`;
    }
  }
  const pkgRel = path.join(parentRel, "package.json");
  if (filesDiffer(sourceRoot, targetRoot, pkgRel)) {
    return `${pkgRel} differs between source and merge target; dependencies may need to be reinstalled.`;
  }
  return null;
}

function populateNodeModules(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const srcEntry = path.join(sourceDir, entry.name);
    const tgtEntry = path.join(targetDir, entry.name);
    if (entry.isSymbolicLink()) {
      rewriteSymlink(srcEntry, tgtEntry);
    } else if (entry.isDirectory() && entry.name.startsWith("@")) {
      // Scoped package dirs (e.g. `@scope/pkg`) contain the actual package
      // entries one level deeper, which may include workspace symlinks.
      // Recurse so their symlinks are recreated verbatim too.
      populateNodeModules(srcEntry, tgtEntry);
    } else {
      fs.symlinkSync(srcEntry, tgtEntry, entry.isDirectory() ? "dir" : "file");
    }
  }
}

function rewriteSymlink(srcEntry: string, tgtEntry: string): void {
  const linkTarget = fs.readlinkSync(srcEntry);
  if (path.isAbsolute(linkTarget)) {
    // Absolute links already point at a concrete source location (e.g. pnpm
    // content-addressed store entries); copy verbatim.
    fs.symlinkSync(linkTarget, tgtEntry, resolveLinkType(linkTarget));
    return;
  }
  // Relative links typically point at workspace packages. Recreate the link
  // verbatim so it resolves inside `targetDir` (the merged worktree). But
  // workspace packages may export built artifacts (e.g. `dist/`) that live
  // outside git and so won't exist inside the merged worktree — in that case
  // the retargeted link cannot load, so we fall back to the source location
  // where dependencies are already installed. The pre-scan in
  // `findWorkspaceMismatch` proved the source/merged contents match when this
  // fallback is taken, so the source artifacts are a faithful stand-in.
  const targetDest = path.resolve(path.dirname(tgtEntry), linkTarget);
  if (packageCanResolve(targetDest)) {
    fs.symlinkSync(linkTarget, tgtEntry, resolveLinkType(targetDest));
    return;
  }
  const sourceDest = path.resolve(path.dirname(srcEntry), linkTarget);
  fs.symlinkSync(sourceDest, tgtEntry, resolveLinkType(sourceDest));
}

interface WorkspacePkgManifest {
  main?: string;
  module?: string;
  exports?: unknown;
}

function packageCanResolve(pkgPath: string): boolean {
  let pkg: WorkspacePkgManifest;
  try {
    pkg = JSON.parse(
      fs.readFileSync(path.join(pkgPath, "package.json"), "utf8"),
    ) as WorkspacePkgManifest;
  } catch {
    // No package.json (or unreadable): assume it's a plain directory worth
    // linking to (e.g. `.bin` stubs, type-only packages) and skip the check.
    return true;
  }
  const entrypoints: string[] = [];
  if (typeof pkg.main === "string") entrypoints.push(pkg.main);
  if (typeof pkg.module === "string") entrypoints.push(pkg.module);
  collectExportPaths(pkg.exports, entrypoints);
  // Package with no declared entrypoints (e.g. CLI-only tools) may still be
  // resolvable; skip the check rather than forcing an abort.
  if (entrypoints.length === 0) return true;
  for (const rel of entrypoints) {
    if (!fs.existsSync(path.join(pkgPath, rel))) return false;
  }
  return true;
}

function collectExportPaths(node: unknown, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectExportPaths(v, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectExportPaths(v, out);
    }
  }
}

function findWorkspaceMismatch(sourceNm: string, targetNm: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sourceNm, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const srcEntry = path.join(sourceNm, entry.name);
    const tgtEntry = path.join(targetNm, entry.name);
    if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(srcEntry);
      if (path.isAbsolute(linkTarget)) continue;
      const targetDest = path.resolve(path.dirname(tgtEntry), linkTarget);
      if (packageCanResolve(targetDest)) continue;
      const sourceDest = path.resolve(path.dirname(srcEntry), linkTarget);
      const diverged = findPackageContentMismatch(sourceDest, targetDest);
      if (diverged) {
        return `workspace package "${entry.name}" diverged between source and merged tree (${diverged}); rebuild its artifacts inside the merged worktree and retry.`;
      }
    } else if (entry.isDirectory() && entry.name.startsWith("@")) {
      const nested = findWorkspaceMismatch(srcEntry, tgtEntry);
      if (nested) return nested;
    }
  }
  return null;
}

function findPackageContentMismatch(sourcePkg: string, targetPkg: string): string | null {
  const sourceFiles = collectTrackedLikeFiles(sourcePkg);
  const targetFiles = collectTrackedLikeFiles(targetPkg);
  for (const rel of sourceFiles) {
    if (!targetFiles.has(rel)) return `${rel} missing in merged tree`;
    const sourceHash = hashFile(path.join(sourcePkg, rel));
    const targetHash = hashFile(path.join(targetPkg, rel));
    if (sourceHash !== targetHash) return `${rel} differs`;
  }
  for (const rel of targetFiles) {
    if (!sourceFiles.has(rel)) return `${rel} present in merged tree only`;
  }
  return null;
}

function collectTrackedLikeFiles(dir: string): Set<string> {
  const files = new Set<string>();
  walkPackageFiles(dir, dir, files);
  return files;
}

function walkPackageFiles(base: string, dir: string, out: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (PACKAGE_ARTIFACT_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkPackageFiles(base, full, out);
    } else if (entry.isFile()) {
      out.add(path.relative(base, full));
    }
  }
}

function resolveLinkType(absTarget: string): "dir" | "file" {
  try {
    return fs.statSync(absTarget).isDirectory() ? "dir" : "file";
  } catch {
    // Target missing (e.g. pnpm's `.bin` shims or broken link): default to
    // file, which is the safer fallback for executables and stubs.
    return "file";
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
