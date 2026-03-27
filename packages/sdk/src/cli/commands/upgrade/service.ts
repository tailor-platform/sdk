import * as fs from "node:fs";
import * as readline from "node:readline";
import * as path from "pathe";
import { CLIError } from "@/cli/shared/errors";
import { logger, styles } from "@/cli/shared/logger";
import { collectFiles } from "./file-collector";
import { printMigrationSummary } from "./reporter";
import { createDefaultRegistry } from "./rules";
import { detectInstalledVersion } from "./version-detector";
import type { FileDiff, MigrationSummary } from "./types";

interface UpgradeOptions {
  to: string;
  dryRun: boolean;
  path: string;
  interactive?: boolean;
}

async function promptConfirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (y/n) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y"));
    });
  });
}

/**
 * Run the upgrade pipeline:
 * 1. Detect current SDK version
 * 2. Select applicable rules
 * 3. Collect target files
 * 4. Execute each rule
 * 5. Print summary
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

  // Step 2: Select applicable rules
  const registry = createDefaultRegistry();
  const rules = registry.getApplicableRules(currentVersion, options.to);

  if (rules.length === 0) {
    logger.success("No migration rules applicable for this version range.");
    return;
  }

  logger.info(`Found ${styles.bold(String(rules.length))} applicable migration rule(s)`);

  // Step 3: Collect default target files (used by rules without custom patterns)
  const defaultFiles = await collectFiles(projectRoot);

  const hasCustomPatterns = rules.some((r) => r.filePatterns);
  if (defaultFiles.length === 0 && !hasCustomPatterns) {
    logger.warn("No TypeScript files found in the project directory.");
    return;
  }

  if (defaultFiles.length > 0) {
    logger.info(`Scanning ${styles.bold(String(defaultFiles.length))} TypeScript file(s)...`);
  }

  if (options.dryRun) {
    logger.info(`${styles.bold("[Dry Run]")} Changes will be previewed but not applied.`);
  } else if (options.interactive) {
    logger.info(
      `${styles.bold("[Interactive]")} You will be prompted to accept or skip each rule.`,
    );
  }

  logger.log("");

  // Step 4: Execute each rule
  const modifiedFiles = new Set<string>();
  const warnings: string[] = [];
  const errors: MigrationSummary["errors"] = [];
  const allDiffs: FileDiff[] = [];
  let rulesApplied = 0;
  let rulesSkipped = 0;

  for (const rule of rules) {
    logger.info(`Running: ${styles.bold(rule.name)} - ${rule.description}`);

    try {
      // In interactive mode, always run with dryRun to get diffs first
      const effectiveDryRun = options.interactive || options.dryRun;
      const files = rule.filePatterns
        ? await collectFiles(projectRoot, rule.filePatterns)
        : defaultFiles;
      const result = await rule.transform({
        projectRoot,
        files,
        dryRun: effectiveDryRun,
      });

      if (result.changed) {
        if (options.interactive && !options.dryRun && result.diffs) {
          // Show diff preview for each file
          for (const diff of result.diffs) {
            const displayPath = path.relative(projectRoot, diff.file);
            logger.log(`  ${styles.bold(displayPath)}`);
            const lines = diff.before.split("\n").length;
            logger.log(`    ${styles.dim(`${lines} line(s) affected`)}`);
          }

          const accepted = await promptConfirm(`  Apply changes from "${rule.name}"?`);

          if (accepted) {
            // Write the changes
            for (const diff of result.diffs) {
              await fs.promises.writeFile(diff.file, diff.after, "utf-8");
            }
            rulesApplied++;
            for (const file of result.filesModified) {
              modifiedFiles.add(file);
            }
            logger.success(`  ${result.filesModified.length} file(s) modified`);
          } else {
            rulesSkipped++;
            logger.log(`  ${styles.dim("Skipped by user")}`);
          }
        } else {
          // Normal (non-interactive) flow
          rulesApplied++;
          for (const file of result.filesModified) {
            modifiedFiles.add(file);
          }
          if (result.diffs) {
            allDiffs.push(...result.diffs);
          }
          logger.success(`  ${result.filesModified.length} file(s) modified`);
        }
      } else {
        rulesSkipped++;
        logger.log(`  ${styles.dim("No changes needed")}`);
      }
      warnings.push(...result.warnings);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      errors.push({ ruleId: rule.id, error: normalizedError });
      logger.error(`  Failed: ${normalizedError.message}`);
    }
  }

  const summary: MigrationSummary = {
    rulesApplied,
    rulesSkipped,
    filesModified: [...modifiedFiles],
    warnings,
    errors,
    diffs: allDiffs.length > 0 ? allDiffs : undefined,
  };

  logger.log("");

  // Step 5: Print summary
  printMigrationSummary(summary, options.dryRun);

  if (summary.errors.length > 0) {
    throw CLIError({
      message: `Migration completed with ${summary.errors.length} error(s)`,
      suggestion: "Review the errors above and re-run the migration after fixing the issues.",
      command: "upgrade",
    });
  }
}
