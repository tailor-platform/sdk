import * as fs from "node:fs";
import * as url from "node:url";
import chalk from "chalk";
import { structuredPatch } from "diff";
import * as path from "pathe";
import picomatch from "picomatch";
import type { CodemodPackage } from "./types";

/**
 * A transform function that receives source text and file path,
 * and returns modified source or null if no changes are needed.
 *
 * For AST-based transforms, use `parseTS`/`parseTSX` from helpers:
 * ```typescript
 * import { parseTS } from "@tailor-platform/sdk-codemod/helpers";
 * export default function transform(source: string): string | null {
 *   const root = parseTS(source);
 *   // ... findAll, replace, commitEdits
 * }
 * ```
 *
 * For text-based transforms (e.g., JSON):
 * ```typescript
 * export default function transform(source: string, filePath: string): string | null {
 *   const json = JSON.parse(source);
 *   json.key = "newValue";
 *   return JSON.stringify(json, null, 2);
 * }
 * ```
 */
export type TransformFn = (
  source: string,
  filePath: string,
) => Promise<string | null> | string | null;

/** Result of running codemods on a project. */
export interface CodemodRunResult {
  changed: boolean;
  filesModified: string[];
  warnings: string[];
}

/** Default file patterns for TypeScript files. */
const DEFAULT_FILE_PATTERNS = ["**/*.{ts,tsx,mts,cts}"];

/** Directory names always excluded from recursive scanning. */
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git"]);

/**
 * Recursively walk a directory and collect relative file paths.
 * Compatible with Node 18+ (does not rely on fs.glob which requires Node 22).
 * @param root - Root directory to walk
 * @returns Array of relative file paths (forward-slash separated)
 */
async function walkDir(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        results.push(prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  }

  await walk(root, "");
  return results;
}

/**
 * Print a colorized unified diff for a single file to stderr.
 * @param filePath - Absolute path to the file
 * @param before - Original content
 * @param after - Transformed content
 */
function printDiff(filePath: string, before: string, after: string): void {
  const patch = structuredPatch(filePath, filePath, before, after, "", "", { context: 3 });
  if (patch.hunks.length === 0) return;

  process.stderr.write(`\n${chalk.bold(`--- ${filePath}`)}\n`);
  process.stderr.write(`${chalk.bold(`+++ ${filePath}`)}\n`);

  for (const hunk of patch.hunks) {
    process.stderr.write(
      chalk.cyan(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`),
    );
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        process.stderr.write(`${chalk.green(line)}\n`);
      } else if (line.startsWith("-")) {
        process.stderr.write(`${chalk.red(line)}\n`);
      } else {
        process.stderr.write(`${line}\n`);
      }
    }
  }
}

/**
 * Load a transform module from a TypeScript file path.
 * Expects the module to have a default export that is a TransformFn.
 * @param scriptPath - Absolute path to the transform script
 * @returns The transform function
 */
async function loadTransform(scriptPath: string): Promise<TransformFn> {
  const mod = await import(url.pathToFileURL(scriptPath).href);
  if (typeof mod.default !== "function") {
    throw new Error(`Transform at ${scriptPath} does not have a default export function`);
  }
  return mod.default as TransformFn;
}

/** A loaded transform with its file matcher. */
interface LoadedTransform {
  transform: TransformFn;
  matches: (relativePath: string) => boolean;
}

/**
 * Run multiple codemods on a project directory using in-memory chaining.
 * Each file is processed through all transforms whose filePatterns match it.
 * Later transforms see earlier transforms' output — even in dry-run mode.
 *
 * In dry-run mode, colorized diffs are printed to stderr.
 * @param codemods - Codemod packages to run (with resolved script paths)
 * @param targetPath - Project directory to transform
 * @param dryRun - Whether to preview changes without writing
 * @returns Combined result of all codemod executions
 */
export async function runCodemods(
  codemods: Array<{ codemod: CodemodPackage; scriptPath: string }>,
  targetPath: string,
  dryRun: boolean,
): Promise<CodemodRunResult> {
  // Load all transform functions with their file matchers
  const loaded: LoadedTransform[] = [];
  for (const { codemod, scriptPath } of codemods) {
    const patterns = codemod.filePatterns ?? DEFAULT_FILE_PATTERNS;
    loaded.push({
      transform: await loadTransform(scriptPath),
      matches: picomatch(patterns),
    });
  }

  // Collect all unique file patterns and build a combined matcher
  const allPatterns: string[] = [];
  for (const { codemod } of codemods) {
    for (const p of codemod.filePatterns ?? DEFAULT_FILE_PATTERNS) {
      allPatterns.push(p);
    }
  }
  const fileMatcher = picomatch(allPatterns);

  // Walk directory once and filter by combined patterns
  const allFiles = await walkDir(targetPath);
  const filesModified: string[] = [];
  const warnings: string[] = [];

  for (const relative of allFiles) {
    if (!fileMatcher(relative)) continue;

    const absolute = path.resolve(targetPath, relative);

    let original: string;
    try {
      original = await fs.promises.readFile(absolute, "utf-8");
    } catch {
      continue;
    }

    // Chain only transforms whose filePatterns match this file
    let current = original;
    let matched = false;
    for (const { transform, matches } of loaded) {
      if (!matches(relative)) continue;
      matched = true;
      const result = await transform(current, absolute);
      if (result != null) {
        current = result;
      }
    }

    if (current !== original) {
      filesModified.push(absolute);
      if (dryRun) {
        printDiff(absolute, original, current);
      } else {
        await fs.promises.writeFile(absolute, current, "utf-8");
      }
    } else if (matched && original.includes("defineGenerators")) {
      // File matched a codemod and contains legacy API but was not modified.
      // This likely means it uses unsupported patterns (custom generators,
      // aliased imports, etc.) that require manual migration.
      warnings.push(
        `${relative}: contains defineGenerators but was not migrated automatically. Manual migration may be needed.`,
      );
    }
  }

  return {
    changed: filesModified.length > 0,
    filesModified,
    warnings,
  };
}
