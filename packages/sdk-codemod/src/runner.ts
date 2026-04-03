import * as fs from "node:fs";
import { glob } from "node:fs/promises";
import { parse, Lang } from "@ast-grep/napi";
import * as path from "pathe";
import type { SgRoot } from "@ast-grep/napi";
import type { CodemodPackage } from "./types";

/** A transform function that receives a parsed AST root and returns modified source or null. */
export type TransformFn = (root: SgRoot) => Promise<string | null> | string | null;

/** Result of running codemods on a project. */
export interface CodemodRunResult {
  changed: boolean;
  filesModified: string[];
  warnings: string[];
  diffOutput?: string;
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
 * Generate a simple unified-diff-style output for a single file.
 * @param filePath - Absolute path to the file
 * @param before - Original content
 * @param after - Transformed content
 * @returns Formatted diff string
 */
function formatDiff(filePath: string, before: string, after: string): string {
  const lines: string[] = [];
  lines.push("============================================================");
  lines.push(`File: ${filePath}`);
  lines.push("============================================================");
  lines.push(`--- [before] ${filePath}`);
  lines.push(`+++ [after]  ${filePath}`);

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  let additions = 0;
  let deletions = 0;

  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b !== a) {
      if (b !== undefined) {
        lines.push(`-${b}`);
        deletions++;
      }
      if (a !== undefined) {
        lines.push(`+${a}`);
        additions++;
      }
    }
  }

  lines.push(`+${additions} additions, -${deletions} deletions`);
  return lines.join("\n");
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
  const diffs: string[] = [];

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
        diffs.push(formatDiff(absolute, original, current));
      } else {
        await fs.promises.writeFile(absolute, current, "utf-8");
      }
    }
  }

  return {
    changed: filesModified.length > 0,
    filesModified,
    warnings: [],
    diffOutput: diffs.length > 0 ? diffs.join("\n\n") : undefined,
  };
}
