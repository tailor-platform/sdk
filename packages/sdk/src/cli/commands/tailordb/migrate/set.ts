import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { resourceTrn, writeMetadataLabels } from "#/cli/commands/deploy/label";
import { confirmationArgs, deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger, styles } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { getNamespacesWithMigrations, selectTargetNamespace } from "./config";
import { parseMigrationNumberArg } from "./migration-number";
import { fetchRemoteMigrationNumber } from "./remote-state";
import { assertMigrationNumberExists, formatMigrationNumber } from "./snapshot";
import { MIGRATION_LABEL_KEY, MIGRATION_LABEL_PREFIX } from "./types";

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
  const migrationNumber = parseMigrationNumberArg(options.number);

  // 2. Load configuration
  const { config } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);

  // 3. Determine target namespace
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  const target = selectTargetNamespace(namespacesWithMigrations, options.namespace);
  const targetNamespace = target.namespace;

  // 4. Validate the number exists in the local migration history
  assertMigrationNumberExists(target.migrationsDir, migrationNumber);

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
  const current = await fetchRemoteMigrationNumber(client, trn);
  const currentMigration = current ?? 0;

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
  await writeMetadataLabels(client, {
    trn,
    labels: {
      [MIGRATION_LABEL_KEY]: `${MIGRATION_LABEL_PREFIX}${formatMigrationNumber(migrationNumber)}`,
    },
  });

  logger.success(
    `Migration checkpoint set to ${styles.bold(formatMigrationNumber(migrationNumber))} for namespace ${styles.bold(targetNamespace)}`,
  );
}

export const setCommand = defineAppCommand({
  name: "set",
  description: "Set migration checkpoint to a specific number.",
  args: z.strictObject({
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
  }),
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
