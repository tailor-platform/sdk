import { spawnSync } from "node:child_process";
import { CLIError } from "@/cli/shared/errors";
import { logger, styles } from "@/cli/shared/logger";
import { detectInstalledVersion } from "./version-detector";
import type { RunOutput } from "./types";

interface UpgradeOptions {
  from: string;
  dryRun: boolean;
  path: string;
}

/**
 * Print the upgrade summary to the terminal.
 * @param output - The parsed JSON output from sdk-codemod
 * @param dryRun - Whether this was a dry-run
 */
function printUpgradeSummary(output: RunOutput, dryRun: boolean): void {
  if (dryRun) {
    logger.info(`${styles.bold("[Dry Run]")} No files were modified.`);
    logger.log("");
  }

  const total = output.codemodsApplied + output.codemodsSkipped + output.errors.length;
  logger.info(
    `Upgrade complete: ${styles.success(`${output.codemodsApplied} applied`)}, ${styles.dim(`${output.codemodsSkipped} skipped`)} (${total} total codemods)`,
  );

  if (output.filesModified.length > 0) {
    logger.log("");
    logger.info(
      `${dryRun ? "Files that would be modified" : "Modified files"} (${output.filesModified.length}):`,
    );
    for (const file of output.filesModified) {
      logger.log(`  ${styles.path(file)}`);
    }
  }

  if (output.warnings.length > 0) {
    logger.log("");
    logger.warn(`Manual attention needed (${output.warnings.length}):`);
    for (const warning of output.warnings) {
      logger.log(`  ${styles.warning("!")} ${warning}`);
    }
  }

  if (output.errors.length > 0) {
    logger.log("");
    logger.error(`Failed codemods (${output.errors.length}):`);
    for (const { codemodId, message } of output.errors) {
      logger.log(`  ${styles.error(codemodId)}: ${message}`);
    }
  }
}

/**
 * Run the upgrade pipeline:
 * 1. Detect target SDK version from node_modules
 * 2. Invoke @tailor-platform/sdk-codemod CLI
 * 3. Parse JSON output and display results
 * @param options - Upgrade options
 */
export async function upgrade(options: UpgradeOptions): Promise<void> {
  const projectRoot = options.path;

  // Step 1: Detect target SDK version (the newly installed version)
  const targetVersion = await detectInstalledVersion(projectRoot);
  if (!targetVersion) {
    throw CLIError({
      message: `Could not detect installed @tailor-platform/sdk version in ${projectRoot}`,
      suggestion:
        "Ensure @tailor-platform/sdk is installed. Run 'pnpm install' or 'npm install' first.",
      command: "upgrade",
    });
  }

  logger.info(
    `Upgrading from ${styles.highlight(options.from)} → ${styles.highlight(targetVersion)}`,
  );

  if (options.dryRun) {
    logger.info(`${styles.bold("[Dry Run]")} Changes will be previewed but not applied.`);
  }

  logger.log("");

  // Step 2: Invoke sdk-codemod CLI
  // Use "latest" because sdk-codemod may not be published at the exact same
  // version as @tailor-platform/sdk.  Version filtering is handled internally
  // by sdk-codemod's registry via the --from / --to arguments.
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

  const result = spawnSync(
    npxCommand,
    [
      "@tailor-platform/sdk-codemod@latest",
      "--from",
      options.from,
      "--to",
      targetVersion,
      "--target",
      projectRoot,
      ...(options.dryRun ? ["--dry-run"] : []),
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 300_000,
    },
  );

  if (result.error) {
    throw CLIError({
      message: `Failed to run @tailor-platform/sdk-codemod: ${result.error.message}`,
      suggestion: "Ensure npx is available and the network is accessible.",
      command: "upgrade",
    });
  }

  // Check for non-zero exit without a launch error (e.g. registry/auth/network failures)
  if (result.status !== 0 && !result.stdout?.trim()) {
    throw CLIError({
      message: `@tailor-platform/sdk-codemod exited with code ${result.status}`,
      details: result.stderr?.trim() || "(no stderr output)",
      suggestion:
        "Review the error above. Common causes: invalid version arguments, network issues, or missing package registry access.",
      command: "upgrade",
    });
  }

  // Step 3: Parse JSON output
  let output: RunOutput;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    throw CLIError({
      message: "Failed to parse output from @tailor-platform/sdk-codemod",
      details: result.stdout || "(empty stdout)",
      suggestion: "This is likely a bug. Please report it.",
      command: "upgrade",
    });
  }

  // Step 4: Display results
  // Emit structured data on stdout (honors --json via logger.out) and
  // human-readable summary on stderr (via printUpgradeSummary).
  logger.out(output);
  printUpgradeSummary(output, options.dryRun);

  if (output.errors.length > 0) {
    throw CLIError({
      message: `Upgrade completed with ${output.errors.length} error(s)`,
      suggestion: "Review the errors above and re-run the upgrade after fixing the issues.",
      command: "upgrade",
    });
  }
}
