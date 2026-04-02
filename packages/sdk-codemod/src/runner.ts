import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { glob } from "node:fs/promises";
import * as os from "node:os";
import { promisify } from "node:util";
import * as path from "pathe";
import { resolveCodemodScript } from "./registry";
import type { CodemodPackage } from "./types";

const execFileAsync = promisify(execFile);

/** Result of running a single codemod. */
export interface CodemodRunResult {
  changed: boolean;
  filesModified: string[];
  warnings: string[];
  diffOutput?: string;
}

/**
 * Bundle a TypeScript codemod script into a JS file that the jssg runtime can execute.
 * @param scriptPath - Absolute path to the TypeScript transform file
 * @returns Path to the bundled JS file in a temp directory
 */
async function bundleCodemod(scriptPath: string): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codemod-bundle-"));
  const outputPath = path.join(tmpDir, "transform.js");

  await execFileAsync("npx", ["codemod", "jssg", "bundle", scriptPath, "-o", outputPath], {
    timeout: 30_000,
  });

  return outputPath;
}

/**
 * Parse file paths from codemod CLI dry-run output.
 * @param output - The CLI stdout/stderr output
 * @returns Array of modified file paths
 */
function parseModifiedFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("File:")) {
      files.push(trimmed.slice("File:".length).trim());
    }
  }
  return files;
}

/**
 * Check if the codemod output indicates changes were made.
 * @param output - The CLI stdout/stderr output
 * @returns true if changes were detected
 */
function hasChanges(output: string): boolean {
  return output.includes("additions") || output.includes("deletions") || output.includes("--- [");
}

/**
 * Extract diff sections from codemod CLI dry-run output.
 * @param output - The CLI stdout/stderr output
 * @returns Cleaned diff output, or undefined if no diffs found
 */
function extractDiffOutput(output: string): string | undefined {
  const lines = output.split("\n");
  const diffLines: string[] = [];
  let inDiff = false;

  for (const line of lines) {
    if (line.startsWith("=====")) {
      inDiff = true;
    }
    if (line.includes("Done in")) {
      break;
    }
    if (inDiff) {
      diffLines.push(line);
    }
  }

  const result = diffLines.join("\n").trim();
  return result.length > 0 ? result : undefined;
}

/**
 * Run a single codemod via `codemod jssg run`.
 * @param codemod - The codemod package to run
 * @param targetPath - Project directory to transform
 * @param dryRun - Whether to preview changes without writing
 * @returns Result of the codemod execution
 */
export async function runCodemod(
  codemod: CodemodPackage,
  targetPath: string,
  dryRun: boolean,
): Promise<CodemodRunResult> {
  const scriptPath = resolveCodemodScript(codemod.scriptPath);
  const language = codemod.language ?? "typescript";

  const bundledPath = await bundleCodemod(scriptPath);

  const args = [
    "codemod",
    "jssg",
    "run",
    bundledPath,
    "--language",
    language,
    "-t",
    targetPath,
    "--no-interactive",
    "--allow-dirty",
  ];

  if (dryRun) {
    args.push("--dry-run");
  }

  // Snapshot target files before execution for non-dry-run change detection
  const snapshots = new Map<string, string>();
  if (!dryRun) {
    const targetFiles = glob("**/*.{ts,tsx,mts,cts}", {
      cwd: targetPath,
      withFileTypes: false,
      exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
    });
    for await (const relative of targetFiles) {
      const absolute = path.resolve(targetPath, relative);
      try {
        snapshots.set(absolute, await fs.promises.readFile(absolute, "utf-8"));
      } catch {
        // skip unreadable files
      }
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync("npx", args, {
      cwd: targetPath,
      timeout: 120_000,
    });

    const output = stdout + stderr;

    let filesModified: string[];
    let changed: boolean;
    let diffOutput: string | undefined;

    if (dryRun) {
      filesModified = parseModifiedFiles(output);
      changed = filesModified.length > 0 || hasChanges(output);
      diffOutput = extractDiffOutput(output);
    } else {
      filesModified = [];
      for (const [absolute, before] of snapshots) {
        try {
          const after = await fs.promises.readFile(absolute, "utf-8");
          if (after !== before) {
            filesModified.push(absolute);
          }
        } catch {
          // skip
        }
      }
      changed = filesModified.length > 0;
    }

    return { changed, filesModified, warnings: [], diffOutput };
  } catch (error) {
    throw new Error(
      `Codemod ${codemod.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    await fs.promises
      .rm(path.dirname(bundledPath), { recursive: true, force: true })
      .catch(() => {});
  }
}
