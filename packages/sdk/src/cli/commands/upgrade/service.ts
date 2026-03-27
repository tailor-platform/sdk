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
      const files = rule.filePatterns
        ? await collectFiles(projectRoot, rule.filePatterns)
        : defaultFiles;
      const result = await rule.transform({
        projectRoot,
        files,
        dryRun: options.dryRun,
      });

      if (result.changed) {
        rulesApplied++;
        for (const file of result.filesModified) {
          modifiedFiles.add(file);
        }
        if (result.diffs) {
          allDiffs.push(...result.diffs);
        }
        logger.success(`  ${result.filesModified.length} file(s) modified`);
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
