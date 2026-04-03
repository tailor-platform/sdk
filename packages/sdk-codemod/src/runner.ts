import * as fs from "node:fs";
import { glob } from "node:fs/promises";
import { parse, Lang } from "@ast-grep/napi";
import chalk from "chalk";
import { structuredPatch } from "diff";
import * as path from "pathe";
import picomatch from "picomatch";
import type { SgRoot } from "@ast-grep/napi";
import type { CodemodPackage } from "./types";

/** A transform function that receives a parsed AST root and returns modified source or null. */
export type TransformFn = (root: SgRoot) => Promise<string | null> | string | null;

/** Result of running codemods on a project. */
export interface CodemodRunResult {
  changed: boolean;
  filesModified: string[];
  warnings: string[];
}

/** Default file patterns for TypeScript files. */
const DEFAULT_FILE_PATTERNS = ["**/*.{ts,tsx,mts,cts}"];

/** Directories always excluded from file scanning. */
const EXCLUDE_PATTERNS = ["**/node_modules/**", "**/dist/**", "**/.git/**"];

/**
 * Determine the ast-grep language for a file extension.
 * @param filePath - Path to the file
 * @returns The ast-grep Lang enum value
 */
function langForFile(filePath: string): Lang {
  return filePath.endsWith(".tsx") ? Lang.Tsx : Lang.TypeScript;
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
  const mod = await import(scriptPath);
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

  // Collect all unique file patterns for glob scanning
  const allPatterns = new Set<string>();
  for (const { codemod } of codemods) {
    for (const p of codemod.filePatterns ?? DEFAULT_FILE_PATTERNS) {
      allPatterns.add(p);
    }
  }

  const filesModified: string[] = [];

  // Iterate over all matching files
  for (const pattern of allPatterns) {
    const targetFiles = glob(pattern, {
      cwd: targetPath,
      withFileTypes: false,
      exclude: EXCLUDE_PATTERNS,
    });

    for await (const relative of targetFiles) {
      const absolute = path.resolve(targetPath, relative);
      let original: string;
      try {
        original = await fs.promises.readFile(absolute, "utf-8");
      } catch {
        continue;
      }

      const lang = langForFile(absolute);

      // Chain only transforms whose filePatterns match this file
      let current = original;
      for (const { transform, matches } of loaded) {
        if (!matches(relative)) continue;
        const root = parse(lang, current);
        const result = await transform(root);
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
      }
    }
  }

  return {
    changed: filesModified.length > 0,
    filesModified,
    warnings: [],
  };
}
