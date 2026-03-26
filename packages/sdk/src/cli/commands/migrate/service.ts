import { CLIError } from "@/cli/shared/errors";
import { logger, styles } from "@/cli/shared/logger";
import { collectFiles } from "./file-collector";
import { printMigrationSummary } from "./reporter";
import { createDefaultRegistry } from "./rules";
import { detectInstalledVersion } from "./version-detector";
import type { MigrationSummary, TransformResult } from "./types";

interface MigrateOptions {
  to: string;
  dryRun: boolean;
  path: string;
}

/**
 * Run the migration pipeline:
 * 1. Detect current SDK version
 * 2. Select applicable rules
 * 3. Collect target files
 * 4. Execute each rule
 * 5. Print summary
 * @param options - Migration options including target version, dry-run flag, and project path
 */
export async function migrate(options: MigrateOptions): Promise<void> {
  const projectRoot = options.path;

  // Step 1: Detect current SDK version
  const currentVersion = await detectInstalledVersion(projectRoot);
  if (!currentVersion) {
    throw CLIError({
      message: `Could not detect installed @tailor-platform/sdk version in ${projectRoot}`,
      suggestion:
        "Ensure @tailor-platform/sdk is installed. Run 'pnpm install' or 'npm install' first.",
      command: "migrate",
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

  // Step 3: Collect target files
  const files = await collectFiles(projectRoot);
  if (files.length === 0) {
    logger.warn("No TypeScript files found in the project directory.");
    return;
  }

  logger.info(`Scanning ${styles.bold(String(files.length))} TypeScript file(s)...`);

  if (options.dryRun) {
    logger.info(`${styles.bold("[Dry Run]")} Changes will be previewed but not applied.`);
  }

  logger.log("");

  // Step 4: Execute each rule
  const summary: MigrationSummary = {
    rulesApplied: 0,
    rulesSkipped: 0,
    filesModified: [],
    warnings: [],
    errors: [],
  };

  for (const rule of rules) {
    logger.info(`Running: ${styles.bold(rule.name)} - ${rule.description}`);

    try {
      const result: TransformResult = await rule.transform({
        projectRoot,
        files,
        dryRun: options.dryRun,
      });

      if (result.changed) {
        summary.rulesApplied++;
        for (const file of result.filesModified) {
          if (!summary.filesModified.includes(file)) {
            summary.filesModified.push(file);
          }
        }
        logger.success(`  ${result.filesModified.length} file(s) modified`);
      } else {
        summary.rulesSkipped++;
        logger.log(`  ${styles.dim("No changes needed")}`);
      }
      summary.warnings.push(...result.warnings);
    } catch (error) {
      summary.errors.push({
        ruleId: rule.id,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      logger.error(`  Failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  logger.log("");

  // Step 5: Print summary
  printMigrationSummary(summary, options.dryRun);

  if (summary.errors.length > 0) {
    throw CLIError({
      message: `Migration completed with ${summary.errors.length} error(s)`,
      suggestion: "Review the errors above and re-run the migration after fixing the issues.",
      command: "migrate",
    });
  }
}
