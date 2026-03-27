import * as path from "pathe";
import { logger, styles } from "@/cli/shared/logger";
import type { FileDiff, MigrationSummary } from "./types";

/**
 * Generate a simple line-by-line diff between two strings.
 * Shows only changed lines with -/+ prefixes.
 * @param before - Original content
 * @param after - Transformed content
 * @returns Array of formatted diff lines with -/+ prefixes
 */
function formatLineDiff(before: string, after: string): string[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines: string[] = [];
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    const bLine = beforeLines[i];
    const aLine = afterLines[i];
    if (bLine !== aLine) {
      if (bLine !== undefined) lines.push(styles.error(`-  ${bLine}`));
      if (aLine !== undefined) lines.push(styles.success(`+  ${aLine}`));
    }
  }

  return lines;
}

/**
 * Print file diffs for dry-run mode.
 * @param diffs - Array of file diffs to display
 * @param projectRoot - Project root for relative path display
 */
function printDiffs(diffs: FileDiff[], projectRoot?: string): void {
  // Group diffs by file (multiple rules may touch the same file)
  const byFile = new Map<string, FileDiff>();
  for (const diff of diffs) {
    // Keep the last diff for each file (it has the cumulative changes)
    byFile.set(diff.file, diff);
  }

  for (const [file, diff] of byFile) {
    const displayPath = projectRoot ? path.relative(projectRoot, file) : file;
    const diffLines = formatLineDiff(diff.before, diff.after);
    if (diffLines.length > 0) {
      logger.log(`  ${styles.bold(displayPath)}`);
      for (const line of diffLines) {
        logger.log(`    ${line}`);
      }
      logger.log("");
    }
  }
}

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
  const totalRules = summary.rulesApplied + summary.rulesSkipped + summary.errors.length;
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

  // Diffs (dry-run only)
  if (dryRun && summary.diffs && summary.diffs.length > 0) {
    logger.log("");
    logger.info("Changes preview:");
    logger.log("");
    printDiffs(summary.diffs);
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
}
