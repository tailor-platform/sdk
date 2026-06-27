import * as fs from "node:fs";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { resourceTrn } from "#/cli/commands/deploy/label";
import { deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger, styles } from "#/cli/shared/logger";
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
  json?: boolean;
}

interface PendingMigrationStatusInfo {
  number: number;
  label: string;
  description?: string;
}

interface MigrationStatusInfo {
  namespace: string;
  currentMigration: number;
  currentMigrationLabel: string;
  pendingMigrations: PendingMigrationStatusInfo[];
}

async function collectMigrationStatuses(options: StatusOptions): Promise<MigrationStatusInfo[]> {
  const { config } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);

  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);

  if (namespacesWithMigrations.length === 0) {
    throw new Error("No TailorDB services with migrations configuration found");
  }

  const targetNamespaces = options.namespace
    ? namespacesWithMigrations.filter((ns) => ns.namespace === options.namespace)
    : namespacesWithMigrations;

  if (targetNamespaces.length === 0) {
    throw new Error(
      `Namespace "${options.namespace}" not found or does not have migrations configured`,
    );
  }

  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const statuses: MigrationStatusInfo[] = [];

  for (const { namespace, migrationsDir } of targetNamespaces) {
    const trn = resourceTrn(workspaceId, "tailordb", namespace);
    let currentMigration: number;
    try {
      const { metadata } = await client.getMetadata({ trn });
      const label = metadata?.labels["sdk-migration"];
      currentMigration = label ? (parseMigrationLabelNumber(label) ?? 0) : 0;
    } catch {
      currentMigration = 0;
    }

    const migrationFiles = getMigrationFiles(migrationsDir);
    const availableNumbers = migrationFiles
      .map((f) => f.number)
      .filter((n, i, arr) => arr.indexOf(n) === i) // deduplicate
      .toSorted((a, b) => a - b);
    const pendingNumbers = availableNumbers.filter((n) => n > currentMigration);

    const pendingMigrations = pendingNumbers.map((num) => {
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

      return {
        number: num,
        label: formatMigrationNumber(num),
        ...(description ? { description } : {}),
      };
    });

    statuses.push({
      namespace,
      currentMigration,
      currentMigrationLabel: formatMigrationNumber(currentMigration),
      pendingMigrations,
    });
  }

  return statuses;
}

function printMigrationStatuses(statuses: MigrationStatusInfo[]): void {
  for (const statusInfo of statuses) {
    logger.newline();
    logger.info(`Namespace: ${styles.bold(statusInfo.namespace)}`);
    logger.log(`  Current migration: ${styles.bold(statusInfo.currentMigrationLabel)}`);

    if (statusInfo.pendingMigrations.length > 0) {
      logger.log("  Pending migrations:");
      for (const pending of statusInfo.pendingMigrations) {
        if (pending.description) {
          logger.log(`    - ${pending.label}: ${pending.description}`);
        } else {
          logger.log(`    - ${pending.label}`);
        }
      }
    } else {
      logger.log("  Pending migrations: (none)");
    }
  }

  logger.newline();
}

/**
 * Show migration status for TailorDB namespaces
 * @param {StatusOptions} options - Command options
 */
async function status(options: StatusOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  const statuses = await collectMigrationStatuses(options);
  if (options.json) {
    logger.out(statuses);
    return;
  }

  printMigrationStatuses(statuses);
}

export const statusCommand = defineAppCommand({
  name: "status",
  description:
    "Show the current migration status for TailorDB namespaces, including applied and pending migrations.",
  args: z.strictObject({
    ...deploymentArgs,
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (shows all namespaces if not specified)",
    }),
  }),
  run: async (args) => {
    await status({
      configPath: args.config,
      namespace: args.namespace,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      json: logger.jsonMode,
    });
  },
});
