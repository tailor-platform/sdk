import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { withDeployLock } from "#/cli/commands/deploy/deploy-lock";
import { resourceTrn } from "#/cli/commands/deploy/label";
import { updateMigrationLabel } from "#/cli/commands/deploy/tailordb/migration";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { confirmationArgs, deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { formatNextAction } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { PluginManager } from "#/plugin/manager";
import { getNamespacesWithMigrations, selectTargetNamespace } from "./config";
import { formatMigrationDiff, hasChanges } from "./diff-calculator";
import { captureFileState, captureMigrationFileState } from "./file-state";
import { fetchRemoteMigrationState } from "./remote-state";
import {
  formatRemoteVerificationResults,
  toTailorDBDeployInput,
  verifyRemoteSchema,
} from "./schema-checks";
import {
  assertValidMigrationFiles,
  compareLocalTypesWithSnapshot,
  createSnapshotFromLocalTypes,
  formatMigrationNumber,
  getLatestMigrationNumber,
  loadSnapshot,
  MIGRATION_FILE_NAMES,
  MIGRATION_NUMBER_PATTERN,
  reconstructSnapshotFromMigrations,
  SCHEMA_SNAPSHOT_VERSION,
  type NormalizedSchemaSnapshot,
  type RebaselineMarker,
} from "./snapshot";
import { generateSchemaFile } from "./template-generator";
import { createMigrationHistoryId } from "./types";

export interface RebaselineOptions {
  configPath?: string;
  namespace?: string;
  yes?: boolean;
  workspaceId?: string;
  profile?: string;
}

const MIGRATION_ARTIFACT_NAMES = new Set(Object.values(MIGRATION_FILE_NAMES));

async function activateBaseline(
  migrationsDir: string,
  snapshot: NormalizedSchemaSnapshot,
  namespace: string,
  rebaseline: RebaselineMarker,
): Promise<void> {
  const resolvedMigrationsDir = await fsPromises.realpath(migrationsDir);
  const parentDir = path.dirname(resolvedMigrationsDir);
  const baseName = path.basename(resolvedMigrationsDir);
  const stagingDir = await fsPromises.mkdtemp(path.join(parentDir, `.${baseName}-rebaseline-`));
  const backupDir = `${stagingDir}-previous`;
  let movedLiveDirectory = false;
  let activatedStagingDirectory = false;

  try {
    await fsPromises.cp(resolvedMigrationsDir, stagingDir, { recursive: true });
    for (const entry of await fsPromises.readdir(stagingDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !MIGRATION_NUMBER_PATTERN.test(entry.name)) continue;
      const entryPath = path.join(stagingDir, entry.name);
      const childNames = await fsPromises.readdir(entryPath);
      if (!childNames.some((childName) => MIGRATION_ARTIFACT_NAMES.has(childName))) continue;
      await fsPromises.rm(entryPath, { recursive: true, force: true });
    }
    const stagedSnapshot = {
      ...snapshot,
      namespace,
      version: SCHEMA_SNAPSHOT_VERSION,
      createdAt: new Date().toISOString(),
      rebaseline,
    };
    const result = await generateSchemaFile(stagedSnapshot, stagingDir, 0);
    loadSnapshot(result.filePath);

    await fsPromises.rename(resolvedMigrationsDir, backupDir);
    movedLiveDirectory = true;
    try {
      await fsPromises.rename(stagingDir, resolvedMigrationsDir);
      activatedStagingDirectory = true;
    } catch (error) {
      await fsPromises.rename(backupDir, resolvedMigrationsDir);
      movedLiveDirectory = false;
      throw error;
    }

    try {
      await fsPromises.rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(
        `The previous migration directory remains at ${backupDir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    movedLiveDirectory = false;
  } finally {
    if (fs.existsSync(stagingDir)) {
      await fsPromises.rm(stagingDir, { recursive: true, force: true });
    }
    if (!activatedStagingDirectory && movedLiveDirectory && fs.existsSync(backupDir)) {
      await fsPromises.rename(backupDir, resolvedMigrationsDir);
    }
  }
}

async function rebaseline(options: RebaselineOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  const loaded = await loadConfig(options.configPath);
  const { config, plugins } = loaded;
  const configDir = path.dirname(config.path);
  const target = selectTargetNamespace(
    getNamespacesWithMigrations(config, configDir),
    options.namespace,
  );
  const generateCommand = formatNextAction({
    command: "tailor",
    args: ["tailordb", "migration", "generate", "--config", config.path],
  });

  assertValidMigrationFiles(target.migrationsDir, target.namespace);
  const latestSnapshot = reconstructSnapshotFromMigrations(target.migrationsDir);
  if (!latestSnapshot) {
    throw new Error(
      `No migration history found for namespace "${target.namespace}". Run ${generateCommand} first.`,
    );
  }
  const latestMigration = getLatestMigrationNumber(target.migrationsDir);
  const currentHistoryId =
    reconstructSnapshotFromMigrations(target.migrationsDir, 0)?.rebaseline?.historyId ?? null;
  const initialFileState = captureMigrationFileState([target])[target.namespace];

  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const { defineApplication } = await import("#/cli/services/application");
  const application = defineApplication({ config, pluginManager });
  for (const service of application.tailorDBServices) {
    await service.loadTypes();
    await service.processNamespacePlugins();
  }
  const targetService = application.tailorDBServices.find(
    (service) => service.namespace === target.namespace,
  );
  if (!targetService) {
    throw new Error(`No TailorDB service found for namespace "${target.namespace}"`);
  }

  const assertLocalTypesReady = (): void => {
    const currentSnapshot = createSnapshotFromLocalTypes(targetService.types, target.namespace);
    const localDiff = compareLocalTypesWithSnapshot(
      latestSnapshot,
      currentSnapshot.tables,
      target.namespace,
    );
    if (hasChanges(localDiff)) {
      logger.error(
        `Migration history does not reproduce the current local schema for namespace ${styles.bold(target.namespace)}:`,
      );
      logger.log(formatMigrationDiff(localDiff));
      throw new Error(
        `Refusing to re-baseline: the migration history must reproduce the current local schema. Run ${generateCommand} first.`,
      );
    }
  };
  const localSourceFiles = (): string[] => [
    config.path,
    ...loadFilesWithIgnores(targetService.config, configDir),
  ];
  assertLocalTypesReady();
  const initialLocalFileState = captureFileState(localSourceFiles());

  const accessToken = await loadAccessToken({ profile: options.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  await withDeployLock(
    { client, workspaceId, applications: [{ name: config.name, id: config.id }] },
    async () => {
      const remoteContextArgs = [
        "--config",
        config.path,
        "--workspace-id",
        workspaceId,
        ...(options.profile ? ["--profile", options.profile] : []),
      ];
      const setBaselineCommand = formatNextAction({
        command: "tailor",
        args: [
          "tailordb",
          "migration",
          "set",
          "0",
          "--namespace",
          target.namespace,
          ...remoteContextArgs,
        ],
      });
      const deployCommand = formatNextAction({
        command: "tailor",
        args: ["deploy", ...remoteContextArgs],
      });

      const assertConnectedWorkspaceReady = async (
        expectedHistoryId: string | null,
        phase: "initial" | "confirmation",
      ): Promise<void> => {
        const remoteState = await fetchRemoteMigrationState(
          client,
          resourceTrn(workspaceId, "tailordb", target.namespace),
        );
        const remoteMigration = remoteState.number;
        if (remoteMigration !== latestMigration) {
          const actual =
            remoteMigration === null ? "<unset>" : formatMigrationNumber(remoteMigration);
          throw new Error(
            `The connected workspace must be at the latest migration ${formatMigrationNumber(latestMigration)} before re-baselining; current checkpoint is ${actual}.`,
          );
        }
        if (remoteState.historyIdInvalid) {
          throw new Error(
            "Refusing to re-baseline: the connected workspace has an invalid migration history marker.",
          );
        }
        if (remoteState.historyId !== expectedHistoryId) {
          throw new Error(
            phase === "confirmation"
              ? "The connected workspace migration history changed while waiting for confirmation. Run the command again."
              : "Refusing to re-baseline: the connected workspace does not match the local migration history.",
          );
        }

        const remoteResults = await verifyRemoteSchema(client, workspaceId, [target], config, [
          toTailorDBDeployInput(targetService),
        ]);
        const remoteResult = remoteResults[0];
        if (
          !remoteResult ||
          remoteResult.remoteMigrationNumber !== latestMigration ||
          remoteResult.hasDrift ||
          remoteResult.checkpointMissingLocal
        ) {
          if (remoteResult?.hasDrift) {
            logger.error("Remote schema drift detected:");
            logger.log(formatRemoteVerificationResults(remoteResults));
          }
          throw new Error(
            "Refusing to re-baseline: the connected workspace remote schema must match the latest migration.",
          );
        }
      };

      await assertConnectedWorkspaceReady(currentHistoryId, "initial");

      logger.newline();
      logger.warn(`This will replace the migration history for ${styles.bold(target.namespace)}.`);
      logger.log(`  Latest migration: ${formatMigrationNumber(latestMigration)}`);
      logger.log("  New history: 0000/schema.json only");
      logger.log("  migrate.ts and db.ts files will disappear from the working tree.");
      logger.log(
        "  Committed migration files will remain in Git history. Preserve any uncommitted files before continuing.",
      );
      logger.log("  Every other environment must already be at the latest migration.");
      logger.log("  The connected workspace checkpoint will be reset to 0000.");
      logger.newline();

      if (!options.yes) {
        const confirmed = await prompt.confirm({
          message:
            "Re-baseline this migration history and reset the connected workspace checkpoint?",
          default: false,
        });
        if (!confirmed) {
          logger.info("Operation cancelled.");
          return;
        }
      }

      assertValidMigrationFiles(target.migrationsDir, target.namespace);
      const currentFileState = captureMigrationFileState([target])[target.namespace];
      if (currentFileState !== initialFileState) {
        throw new Error(
          "Migration files changed while waiting for confirmation. Run the command again.",
        );
      }
      if (captureFileState(localSourceFiles()) !== initialLocalFileState) {
        throw new Error("Local TailorDB table or config files changed. Run the command again.");
      }
      assertLocalTypesReady();
      await assertConnectedWorkspaceReady(currentHistoryId, "confirmation");

      const rebaselineMarker: RebaselineMarker = {
        historyId: createMigrationHistoryId(),
        replacedHistoryId: currentHistoryId,
        replacedLatestMigration: latestMigration,
      };
      await activateBaseline(
        target.migrationsDir,
        latestSnapshot,
        target.namespace,
        rebaselineMarker,
      );
      try {
        await updateMigrationLabel(
          client,
          workspaceId,
          target.namespace,
          0,
          rebaselineMarker.historyId,
        );
      } catch (error) {
        throw new Error(
          `The local migration history was re-baselined, but the connected workspace checkpoint could not be updated. Run ${setBaselineCommand}, or run ${deployCommand} with schema checks enabled after resolving the connection error.`,
          { cause: error },
        );
      }

      logger.success(
        `Re-baselined ${styles.bold(target.namespace)} and reset the connected workspace checkpoint to 0000.`,
      );
    },
  );
}

export const rebaselineCommand = defineAppCommand({
  name: "rebaseline",
  description: "Collapse the full migration history into a new 0000 baseline.",
  notes: `Re-baselining removes migrations after 0000 from the working tree, records a new migration history ID, and resets the connected workspace checkpoint without changing its schema or data. Every environment must already have applied the latest migration before you run this command.`,
  args: z.strictObject({
    ...deploymentArgs,
    ...confirmationArgs,
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (required if multiple namespaces exist)",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    await rebaseline({
      configPath: args.config,
      namespace: args.namespace,
      yes: args.yes,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
  },
});
