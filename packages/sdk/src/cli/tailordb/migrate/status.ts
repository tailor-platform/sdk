import * as fs from "node:fs";
import * as path from "pathe";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import { trnPrefix } from "../../apply/services/label";
import { commonArgs, workspaceArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadConfig } from "../../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logBetaWarning } from "../../utils/beta";
import { logger, styles } from "../../utils/logger";
import { getNamespacesWithMigrations } from "./config";
import {
  getMigrationFiles,
  loadDiff,
  getMigrationFilePath,
  formatMigrationNumber,
} from "./snapshot";
import { parseMigrationLabelNumber } from "./types";

export interface StatusOptions {
  configPath?: string;
  namespace?: string;
  workspaceId?: string;
  profile?: string;
}

/**
 * Show migration status for TailorDB namespaces
 * @param {StatusOptions} options - Command options
 */
async function status(options: StatusOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  // 1. Load configuration
  const { config } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);

  // 2. Get namespaces with migrations
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);

  if (namespacesWithMigrations.length === 0) {
    throw new Error("No TailorDB services with migrations configuration found");
  }

  // 3. Filter by namespace if specified
  const targetNamespaces = options.namespace
    ? namespacesWithMigrations.filter((ns) => ns.namespace === options.namespace)
    : namespacesWithMigrations;

  if (targetNamespaces.length === 0) {
    throw new Error(
      `Namespace "${options.namespace}" not found or does not have migrations configured`,
    );
  }

  // 4. Initialize client
  const accessToken = await loadAccessToken({
    useProfile: false,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  // 5. Display status for each namespace
  for (const { namespace, migrationsDir } of targetNamespaces) {
    // Get current migration number
    const trn = `${trnPrefix(workspaceId)}:tailordb:${namespace}`;
    let currentMigration: number;
    try {
      const { metadata } = await client.getMetadata({ trn });
      const label = metadata?.labels?.["sdk-migration"];
      currentMigration = label ? (parseMigrationLabelNumber(label) ?? 0) : 0;
    } catch {
      currentMigration = 0;
    }

    // Get available migrations
    const migrationFiles = getMigrationFiles(migrationsDir);
    const availableNumbers = migrationFiles
      .map((f) => f.number)
      .filter((n, i, arr) => arr.indexOf(n) === i) // deduplicate
      .sort((a, b) => a - b);
    const pendingNumbers = availableNumbers.filter((n) => n > currentMigration);

    // Display
    logger.newline();
    logger.info(`Namespace: ${styles.bold(namespace)}`);
    logger.log(`  Current migration: ${styles.bold(formatMigrationNumber(currentMigration))}`);

    if (pendingNumbers.length > 0) {
      logger.log("  Pending migrations:");
      for (const num of pendingNumbers) {
        const diffPath = getMigrationFilePath(migrationsDir, num, "diff");
        let description: string | undefined;

        if (fs.existsSync(diffPath)) {
          try {
            const diff = loadDiff(diffPath);
            description = diff.description;
          } catch {
            // Ignore errors loading diff
          }
        }

        if (description) {
          logger.log(`    - ${formatMigrationNumber(num)}: ${description}`);
        } else {
          logger.log(`    - ${formatMigrationNumber(num)}`);
        }
      }
    } else {
      logger.log("  Pending migrations: (none)");
    }
  }

  logger.newline();
}

export const statusCommand = defineCommand({
  name: "status",
  description: "Show migration status for TailorDB namespaces",
  args: z.object({
    ...commonArgs,
    ...workspaceArgs,
    config: arg(z.string().default("tailor.config.ts"), {
      alias: "c",
      description: "Path to SDK config file",
    }),
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (shows all namespaces if not specified)",
    }),
  }),
  run: withCommonArgs(async (args) => {
    await status({
      configPath: args.config,
      namespace: args.namespace,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
  }),
});
