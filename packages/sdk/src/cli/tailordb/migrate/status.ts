import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { trnPrefix } from "../../apply/services/label";
import { commonArgs, workspaceArgs, deploymentArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadConfig } from "../../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logger, styles } from "../../utils/logger";
import { getMigrationFiles, loadDiff } from "./snapshot";
import { getNamespacesWithMigrations, getMigrationFilePath } from "./types";
import { formatMigrationNumber, parseMigrationLabelNumber } from "./types";

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
  // 1. Load configuration
  const { config, configPath } = await loadConfig(options.configPath);
  const configDir = path.dirname(configPath);

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
  meta: {
    name: "status",
    description: "Show migration status for TailorDB namespaces",
  },
  args: {
    ...commonArgs,
    ...workspaceArgs,
    ...deploymentArgs,
    namespace: {
      type: "string",
      description: "Target TailorDB namespace (shows all namespaces if not specified)",
      alias: "n",
    },
  },
  run: withCommonArgs(async (args) => {
    await status({
      configPath: typeof args.config === "string" ? args.config : undefined,
      namespace: typeof args.namespace === "string" ? args.namespace : undefined,
      workspaceId: typeof args["workspace-id"] === "string" ? args["workspace-id"] : undefined,
      profile: typeof args.profile === "string" ? args.profile : undefined,
    });
  }),
});
