import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { resourceTrn, writeMetadataLabels } from "#/cli/commands/deploy/label";
import { confirmationArgs, deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { logger, styles } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { getNamespacesWithMigrations, selectTargetNamespace } from "./config";
import { parseMigrationNumberArg } from "./migration-number";
import { fetchRemoteMigrationState } from "./remote-state";
import {
  assertMigrationNumberExists,
  assertValidMigrationFiles,
  formatMigrationNumber,
  reconstructSnapshotFromMigrations,
} from "./snapshot";
import { MIGRATION_HISTORY_LABEL_KEY, MIGRATION_LABEL_KEY, sanitizeMigrationLabel } from "./types";

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

  // 4. Validate the local migration history and the requested number
  assertValidMigrationFiles(target.migrationsDir, targetNamespace);
  assertMigrationNumberExists(target.migrationsDir, migrationNumber);
  const historyId = reconstructSnapshotFromMigrations(target.migrationsDir, 0)?.rebaseline
    ?.historyId;

  // 5. Initialize client
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
  });

  // 6. Get current migration state
  const trn = resourceTrn(workspaceId, "tailordb", targetNamespace);
  const currentState = await fetchRemoteMigrationState(client, trn);
  const current = currentState.number;
  const currentMigration = current ?? 0;
  const currentHistoryId = currentState.historyIdInvalid
    ? "<invalid>"
    : (currentState.historyId ?? "<unset>");
  const newHistoryId = historyId ?? "<unset>";

  // 7. Display warning and confirmation
  logger.newline();
  logger.warn("This operation will change TailorDB migration state metadata.");
  logger.log(`Namespace: ${styles.bold(targetNamespace)}`);
  logger.log(
    `Current migration: ${current === null ? "<unset>" : styles.bold(formatMigrationNumber(current))}`,
  );
  logger.log(`New migration: ${styles.bold(formatMigrationNumber(migrationNumber))}`);
  logger.log(`Current migration history ID: ${styles.bold(currentHistoryId)}`);
  logger.log(`New migration history ID: ${styles.bold(newHistoryId)}`);
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
      message: "Continue with migration checkpoint and history ID update?",
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
      [MIGRATION_LABEL_KEY]: sanitizeMigrationLabel(migrationNumber),
      ...(historyId ? { [MIGRATION_HISTORY_LABEL_KEY]: historyId } : {}),
    },
    remove: historyId ? undefined : [MIGRATION_HISTORY_LABEL_KEY],
  });

  logger.success(
    `Migration checkpoint set to ${styles.bold(formatMigrationNumber(migrationNumber))} for namespace ${styles.bold(targetNamespace)}`,
  );
}

export const setCommand = defineAppCommand({
  name: "set",
  description: "Set migration checkpoint to a specific number.",
  notes: `The migration number must be a 4-digit value (e.g. \`0001\`) or a bare integer (e.g. \`1\`) within 0–9999, and must exist in the local migration history; \`0\` is always accepted as the baseline, provided the local history passes validation. A gapped history is rejected.

Metadata lookup failures (authentication, permission, or network errors) are reported as errors; only a not-yet-deployed namespace is treated as having no checkpoint.`,
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
