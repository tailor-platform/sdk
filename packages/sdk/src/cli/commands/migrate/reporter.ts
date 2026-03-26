import { logger, styles } from "@/cli/shared/logger";
import type { MigrationSummary } from "./types";

/**
 * Print migration results to the terminal.
 * @param summary - The migration run summary
 * @param dryRun - Whether this was a dry-run
 */
export function printMigrationSummary(summary: MigrationSummary, dryRun: boolean): void {
  if (dryRun) {
    logger.info(`${styles.bold("[Dry Run]")} No files were modified.`);
    logger.log("");
  }

  // Rules summary
  const totalRules = summary.rulesApplied + summary.rulesSkipped;
  logger.info(
    `Migration complete: ${styles.success(`${summary.rulesApplied} applied`)}, ${styles.dim(`${summary.rulesSkipped} skipped`)} (${totalRules} total rules)`,
  );

  // Modified files
  if (summary.filesModified.length > 0) {
    logger.log("");
    logger.info(
      `${dryRun ? "Files that would be modified" : "Modified files"} (${summary.filesModified.length}):`,
    );
    for (const file of summary.filesModified) {
      logger.log(`  ${styles.path(file)}`);
    }
  }

  // Warnings (manual attention needed)
  if (summary.warnings.length > 0) {
    logger.log("");
    logger.warn(`Manual attention needed (${summary.warnings.length}):`);
    for (const warning of summary.warnings) {
      logger.log(`  ${styles.warning("!")} ${warning}`);
    }
  }

  // Errors
  if (summary.errors.length > 0) {
    logger.log("");
    logger.error(`Failed rules (${summary.errors.length}):`);
    for (const { ruleId, error } of summary.errors) {
      logger.log(`  ${styles.error(ruleId)}: ${error.message}`);
    }
  }

  // Manual attention hint
  if (summary.warnings.length > 0) {
    logger.log("");
    logger.info(
      "Some changes require manual attention. Review the warnings above and update your code accordingly.",
    );
  }
}
