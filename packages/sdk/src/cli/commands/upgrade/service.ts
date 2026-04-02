import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { promisify } from "node:util";
import * as path from "pathe";
import { CLIError } from "@/cli/shared/errors";
import { logger, styles } from "@/cli/shared/logger";
import { getApplicableCodemods, resolveCodemodScript } from "./codemod-registry";
import { detectInstalledVersion } from "./version-detector";
import type { CodemodPackage, CodemodResult, UpgradeSummary } from "./types";

const execFileAsync = promisify(execFile);

interface UpgradeOptions {
  to: string;
  dryRun: boolean;
  path: string;
  interactive?: boolean;
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
 * Run a single codemod via `npx codemod jssg run`.
 * Bundles the TypeScript source first, then executes the bundled JS.
 * @param codemod - The codemod package to run
 * @param options - Upgrade options
 * @returns Result of the codemod execution
 */
async function runCodemod(
  codemod: CodemodPackage,
  options: UpgradeOptions,
): Promise<CodemodResult> {
  const scriptPath = resolveCodemodScript(codemod.scriptPath);
  const language = codemod.language ?? "typescript";

  // Bundle TS → JS for the jssg runtime
  const bundledPath = await bundleCodemod(scriptPath);

  const args = ["codemod", "jssg", "run", bundledPath, "--language", language, "-t", options.path];

  if (options.dryRun) {
    args.push("--dry-run");
  }

  if (!options.interactive) {
    args.push("--no-interactive");
  }

  args.push("--allow-dirty");

  try {
    const { stdout, stderr } = await execFileAsync("npx", args, {
      cwd: options.path,
      timeout: 120_000,
    });

    const output = stdout + stderr;
    const filesModified = parseModifiedFiles(output);
    const changed = filesModified.length > 0 || hasChanges(output);

    return {
      codemod,
      changed,
      filesModified,
      warnings: [],
    };
  } catch (error) {
    throw new Error(
      `Codemod ${codemod.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    // Clean up bundled file
    await fs.promises
      .rm(path.dirname(bundledPath), { recursive: true, force: true })
      .catch(() => {});
  }
}

/**
 * Parse file paths from codemod CLI output.
 * The jssg CLI outputs "File: /path/to/file.ts" lines in dry-run mode.
 * In normal mode, it outputs minimal info. We detect changes by the presence
 * of diff output (additions/deletions line).
 * @param output - The CLI stdout/stderr output
 * @returns Array of modified file paths
 */
function parseModifiedFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    // dry-run: "File: /path/to/file.ts"
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
  // Check for diff output indicators
  return output.includes("additions") || output.includes("deletions") || output.includes("--- [");
}

/**
 * Print the upgrade summary to the terminal.
 * @param summary - The upgrade run summary
 * @param dryRun - Whether this was a dry-run
 */
function printUpgradeSummary(summary: UpgradeSummary, dryRun: boolean): void {
  if (dryRun) {
    logger.info(`${styles.bold("[Dry Run]")} No files were modified.`);
    logger.log("");
  }

  const total = summary.codemodsApplied + summary.codemodsSkipped + summary.errors.length;
  logger.info(
    `Upgrade complete: ${styles.success(`${summary.codemodsApplied} applied`)}, ${styles.dim(`${summary.codemodsSkipped} skipped`)} (${total} total codemods)`,
  );

  if (summary.filesModified.length > 0) {
    logger.log("");
    logger.info(
      `${dryRun ? "Files that would be modified" : "Modified files"} (${summary.filesModified.length}):`,
    );
    for (const file of summary.filesModified) {
      logger.log(`  ${styles.path(file)}`);
    }
  }

  if (summary.warnings.length > 0) {
    logger.log("");
    logger.warn(`Manual attention needed (${summary.warnings.length}):`);
    for (const warning of summary.warnings) {
      logger.log(`  ${styles.warning("!")} ${warning}`);
    }
  }

  if (summary.errors.length > 0) {
    logger.log("");
    logger.error(`Failed codemods (${summary.errors.length}):`);
    for (const { codemodId, error } of summary.errors) {
      logger.log(`  ${styles.error(codemodId)}: ${error.message}`);
    }
  }
}

/**
 * Run the upgrade pipeline:
 * 1. Detect current SDK version
 * 2. Select applicable codemods
 * 3. Execute each codemod via codemod CLI
 * 4. Print summary
 * @param options - Upgrade options including target version, dry-run flag, and project path
 */
export async function upgrade(options: UpgradeOptions): Promise<void> {
  const projectRoot = options.path;

  // Step 1: Detect current SDK version
  const currentVersion = await detectInstalledVersion(projectRoot);
  if (!currentVersion) {
    throw CLIError({
      message: `Could not detect installed @tailor-platform/sdk version in ${projectRoot}`,
      suggestion:
        "Ensure @tailor-platform/sdk is installed. Run 'pnpm install' or 'npm install' first.",
      command: "upgrade",
    });
  }

  logger.info(`Detected SDK version: ${styles.highlight(currentVersion)}`);
  logger.info(`Target version: ${styles.highlight(options.to)}`);

  // Step 2: Select applicable codemods
  const codemods = getApplicableCodemods(currentVersion, options.to);

  if (codemods.length === 0) {
    logger.success("No codemods applicable for this version range.");
    return;
  }

  logger.info(`Found ${styles.bold(String(codemods.length))} applicable codemod(s)`);

  if (options.dryRun) {
    logger.info(`${styles.bold("[Dry Run]")} Changes will be previewed but not applied.`);
  } else if (options.interactive) {
    logger.info(
      `${styles.bold("[Interactive]")} You will be prompted to accept or skip each codemod.`,
    );
  }

  logger.log("");

  // Step 3: Execute each codemod
  const modifiedFiles = new Set<string>();
  const warnings: string[] = [];
  const errors: UpgradeSummary["errors"] = [];
  let codemodsApplied = 0;
  let codemodsSkipped = 0;

  for (const codemod of codemods) {
    logger.info(`Running: ${styles.bold(codemod.name)} - ${codemod.description}`);

    try {
      const result = await runCodemod(codemod, options);

      if (result.changed) {
        codemodsApplied++;
        for (const file of result.filesModified) {
          modifiedFiles.add(file);
        }
        logger.success(`  ${result.filesModified.length} file(s) modified`);
      } else {
        codemodsSkipped++;
        logger.log(`  ${styles.dim("No changes needed")}`);
      }
      warnings.push(...result.warnings);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      errors.push({ codemodId: codemod.id, error: normalizedError });
      logger.error(`  Failed: ${normalizedError.message}`);
    }
  }

  const summary: UpgradeSummary = {
    codemodsApplied,
    codemodsSkipped,
    filesModified: [...modifiedFiles],
    warnings,
    errors,
  };

  logger.log("");

  // Step 4: Print summary
  printUpgradeSummary(summary, options.dryRun);

  if (summary.errors.length > 0) {
    throw CLIError({
      message: `Upgrade completed with ${summary.errors.length} error(s)`,
      suggestion: "Review the errors above and re-run the upgrade after fixing the issues.",
      command: "upgrade",
    });
  }
}
