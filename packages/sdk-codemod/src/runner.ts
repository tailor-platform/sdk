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
  /** IDs of codemods that actually produced changes in at least one file. */
  appliedCodemodIds: Set<string>;
}

/** Default file patterns for TypeScript files. */
const DEFAULT_FILE_PATTERNS = ["**/*.{ts,tsx,mts,cts}"];

/** Directory names always excluded from file scanning. */
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git"]);

async function* walkFiles(root: string, relativeDir = ""): AsyncGenerator<string> {
  const absoluteDir = path.join(root, relativeDir);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      yield* walkFiles(root, relative);
      continue;
    }
    if (entry.isFile()) {
      yield relative;
    }
  }
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
  id: string;
  transform: TransformFn;
  matches: (relativePath: string) => boolean;
  legacyPatterns: string[];
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
      id: codemod.id,
      transform: await loadTransform(scriptPath),
      matches: picomatch(patterns, { dot: true }),
      legacyPatterns: codemod.legacyPatterns ?? [],
    });
  }

  const filesModified: string[] = [];
  const warnings: string[] = [];
  const appliedCodemodIds = new Set<string>();
  const seen = new Set<string>();

  for await (const relative of walkFiles(targetPath)) {
    const absolute = path.resolve(targetPath, relative);
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    let original: string;
    try {
      original = await fs.promises.readFile(absolute, "utf-8");
    } catch {
      continue;
    }

    let current = original;
    const matchedTransforms: LoadedTransform[] = [];
    for (const lt of loaded) {
      if (!lt.matches(relative)) continue;
      matchedTransforms.push(lt);
      const result = await lt.transform(current, absolute);
      if (result != null) {
        current = result;
        appliedCodemodIds.add(lt.id);
      }
    }

    if (current !== original) {
      filesModified.push(absolute);
      if (dryRun) {
        printDiff(absolute, original, current);
      } else {
        await fs.promises.writeFile(absolute, current, "utf-8");
      }
    } else {
      // Check each matched codemod's legacyPatterns for unmodified files
      for (const lt of matchedTransforms) {
        const found = lt.legacyPatterns.filter((p) => original.includes(p));
        if (found.length > 0) {
          warnings.push(
            `${relative}: contains ${found.join(", ")} but was not migrated automatically (rule: ${lt.id}). Manual migration may be needed.`,
          );
        }
      }
    }
  }

  return {
    changed: filesModified.length > 0,
    filesModified,
    warnings,
    appliedCodemodIds,
  };
}
