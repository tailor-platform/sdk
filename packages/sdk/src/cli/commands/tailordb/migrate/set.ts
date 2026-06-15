import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { resourceTrn } from "@/cli/commands/deploy/label";
import { confirmationArgs, deploymentArgs } from "@/cli/shared/args";
import { logBetaWarning } from "@/cli/shared/beta";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger, styles } from "@/cli/shared/logger";
import { prompt } from "@/cli/shared/prompt";
import { assertWritable } from "@/cli/shared/readonly-guard";
import { assertDefined } from "@/utils/assert";
import { getNamespacesWithMigrations } from "./config";
import { formatMigrationNumber, isValidMigrationNumber } from "./snapshot";
import { parseMigrationLabelNumber } from "./types";

export interface SetOptions {
  configPath?: string;
  number: string;
  namespace?: string;
  yes?: boolean;
  workspaceId?: string;
  profile?: string;
}

/**
 * Set migration checkpoint for a TailorDB namespace
 * @param {SetOptions} options - Command options
 */
async function set(options: SetOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  // 1. Validate migration number format
  const numberStr = options.number;

  // Accept either 4-digit format (0001) or integer (1)
  let migrationNumber: number;
  if (isValidMigrationNumber(numberStr)) {
    // 4-digit format
    migrationNumber = parseInt(numberStr, 10);
  } else {
    // Try parsing as integer
    migrationNumber = parseInt(numberStr, 10);
    if (isNaN(migrationNumber) || migrationNumber < 0) {
      throw new Error(
        `Invalid migration number format: ${numberStr}. Expected 4-digit format (e.g., 0001) or integer (e.g., 1).`,
      );
    }
  }

  // 2. Load configuration
  const { config } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);

  // 3. Get namespaces with migrations
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);

  if (namespacesWithMigrations.length === 0) {
    throw new Error("No TailorDB services with migrations configuration found");
  }

  // 4. Determine target namespace
  let targetNamespace: string;
  if (options.namespace) {
    if (!namespacesWithMigrations.some((ns) => ns.namespace === options.namespace)) {
      throw new Error(
        `Namespace "${options.namespace}" not found or does not have migrations configured`,
      );
    }
    targetNamespace = options.namespace;
  } else if (namespacesWithMigrations.length === 1) {
    const [ns] = namespacesWithMigrations;
    targetNamespace = assertDefined(ns, "namespace with migrations missing").namespace;
  } else {
    throw new Error(
      `Multiple TailorDB services found. Please specify namespace with --namespace flag: ${namespacesWithMigrations.map((ns) => ns.namespace).join(", ")}`,
    );
  }

  // 5. Initialize client
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  // 6. Get current migration number
  const trn = resourceTrn(workspaceId, "tailordb", targetNamespace);
  let currentMigration: number;
  try {
    const { metadata } = await client.getMetadata({ trn });
    const label = metadata?.labels["sdk-migration"];
    currentMigration = label ? (parseMigrationLabelNumber(label) ?? 0) : 0;
  } catch {
    currentMigration = 0;
  }

  // 7. Display warning and confirmation
  logger.newline();
  logger.warn("This operation will change the migration checkpoint.");
  logger.log(`Namespace: ${styles.bold(targetNamespace)}`);
  logger.log(`Current migration: ${styles.bold(formatMigrationNumber(currentMigration))}`);
  logger.log(`New migration: ${styles.bold(formatMigrationNumber(migrationNumber))}`);
  logger.newline();

  if (migrationNumber < currentMigration) {
    logger.warn(
      `Setting migration number backwards (${formatMigrationNumber(currentMigration)} → ${formatMigrationNumber(migrationNumber)}) will cause previous migrations to be re-executed on next apply.`,
    );
    logger.newline();
  } else if (migrationNumber > currentMigration) {
    logger.warn(
      `Setting migration number forwards (${formatMigrationNumber(currentMigration)} → ${formatMigrationNumber(migrationNumber)}) will skip migrations ${formatMigrationNumber(currentMigration + 1)} to ${formatMigrationNumber(migrationNumber)}.`,
    );
    logger.newline();
  }

  // 8. Confirmation prompt (unless --yes flag)
  if (!options.yes) {
    const confirmation = await prompt.confirm({
      message: "Continue with migration checkpoint update?",
      default: false,
    });

    if (!confirmation) {
      logger.info("Operation cancelled.");
      return;
    }
    logger.newline();
  }

  // 9. Update migration label
  const { metadata } = await client.getMetadata({ trn });
  const existingLabels = metadata?.labels ?? {};

  await client.setMetadata({
    trn,
    labels: {
      ...existingLabels,
      "sdk-migration": `m${formatMigrationNumber(migrationNumber)}`,
    },
  });

  logger.success(
    `Migration checkpoint set to ${styles.bold(formatMigrationNumber(migrationNumber))} for namespace ${styles.bold(targetNamespace)}`,
  );
}

export const setCommand = defineAppCommand({
  name: "set",
  description: "Set migration checkpoint to a specific number.",
  args: z
    .object({
      ...deploymentArgs,
      ...confirmationArgs,
      number: arg(z.string(), {
        positional: true,
        description: "Migration number to set (e.g., 0001 or 1)",
      }),
      namespace: arg(z.string().optional(), {
        alias: "n",
        description: "Target TailorDB namespace (required if multiple namespaces exist)",
      }),
    })
    .strict(),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    await set({
      configPath: args.config,
      number: args.number,
      namespace: args.namespace,
      yes: args.yes,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
  },
});
