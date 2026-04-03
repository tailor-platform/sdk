import * as fs from "node:fs";
import { glob } from "node:fs/promises";
import { parse, Lang } from "@ast-grep/napi";
import { structuredPatch } from "diff";
import * as path from "pathe";
import pc from "picocolors";
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

  process.stderr.write(`\n${pc.bold(`--- ${filePath}`)}\n`);
  process.stderr.write(`${pc.bold(`+++ ${filePath}`)}\n`);

  for (const hunk of patch.hunks) {
    process.stderr.write(
      pc.cyan(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`),
    );
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        process.stderr.write(`${pc.green(line)}\n`);
      } else if (line.startsWith("-")) {
        process.stderr.write(`${pc.red(line)}\n`);
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

/**
 * Run multiple codemods on a project directory using in-memory chaining.
 * Each codemod's transform is applied sequentially per file via reduce(),
 * so later transforms see earlier transforms' output — even in dry-run mode.
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
  // Load all transform functions
  const transforms: TransformFn[] = [];
  for (const { scriptPath } of codemods) {
    transforms.push(await loadTransform(scriptPath));
  }

  const filesModified: string[] = [];

  // Iterate over all TypeScript files in the target directory
  const targetFiles = glob("**/*.{ts,tsx,mts,cts}", {
    cwd: targetPath,
    withFileTypes: false,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
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

    // Chain all transforms: each receives the previous transform's output
    let current = original;
    for (const transform of transforms) {
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

  return {
    changed: filesModified.length > 0,
    filesModified,
    warnings: [],
  };
}
