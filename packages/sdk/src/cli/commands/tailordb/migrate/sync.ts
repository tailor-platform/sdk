import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { resourceTrn } from "@/cli/commands/deploy/label";
import { confirmationArgs, deploymentArgs } from "@/cli/shared/args";
import { logBetaWarning } from "@/cli/shared/beta";
import { fetchAll, initOperatorClient, type OperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger, styles } from "@/cli/shared/logger";
import { prompt } from "@/cli/shared/prompt";
import { assertWritable } from "@/cli/shared/readonly-guard";
import { getNamespacesWithMigrations, type NamespaceWithMigrations } from "./config";
import {
  formatMigrationNumber,
  isValidMigrationNumber,
  reconstructSnapshotFromMigrations,
  getLatestMigrationNumber,
} from "./snapshot";
import {
  compareSnapshotWithRemote,
  generateAllTypeManifestsFromSnapshot,
} from "./snapshot-manifest";
import type { TailorDBType as ProtoTailorDBType } from "@tailor-proto/tailor/v1/tailordb_resource_pb";

export interface SyncOptions {
  configPath?: string;
  number: string;
  namespace?: string;
  yes?: boolean;
  workspaceId?: string;
  profile?: string;
}

function parseMigrationNumberArg(numberStr: string): number {
  if (isValidMigrationNumber(numberStr)) {
    return parseInt(numberStr, 10);
  }
  const parsed = parseInt(numberStr, 10);
  if (isNaN(parsed) || parsed < 0 || String(parsed) !== numberStr.trimStart().replace(/^0+/, "0")) {
    throw new Error(
      `Invalid migration number format: ${numberStr}. Expected 4-digit format (e.g., 0001) or integer (e.g., 1).`,
    );
  }
  return parsed;
}

async function fetchRemoteTypes(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
): Promise<ProtoTailorDBType[]> {
  return fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName: namespace,
        pageToken,
        pageSize: maxPageSize,
      });
      return [tailordbTypes, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
}

function selectTargetNamespace(
  namespacesWithMigrations: NamespaceWithMigrations[],
  requested: string | undefined,
): NamespaceWithMigrations {
  if (namespacesWithMigrations.length === 0) {
    throw new Error("No TailorDB services with migrations configuration found");
  }
  if (requested) {
    const found = namespacesWithMigrations.find((ns) => ns.namespace === requested);
    if (!found) {
      throw new Error(`Namespace "${requested}" not found or does not have migrations configured`);
    }
    return found;
  }
  if (namespacesWithMigrations.length > 1) {
    throw new Error(
      `Multiple TailorDB services found. Please specify namespace with --namespace flag: ${namespacesWithMigrations
        .map((ns) => ns.namespace)
        .join(", ")}`,
    );
  }
  return namespacesWithMigrations[0];
}

/**
 * Sync remote TailorDB schema to a specific migration snapshot.
 *
 * Reconstructs the schema state at `<number>` from `0000/schema.json` + diffs,
 * then issues create/update/delete RPCs so the remote matches that snapshot.
 * Updates the migration label to `<number>` on success.
 *
 * Intended for recovering from drift introduced by `deploy --no-schema-check`
 * runs against an older revision: instead of having to `git checkout` that
 * revision and re-deploy, the operator can sync the remote back to a known
 * snapshot version directly.
 * @param options - Command options
 */
async function sync(options: SyncOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  const targetVersion = parseMigrationNumberArg(options.number);

  const { config } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  const target = selectTargetNamespace(namespacesWithMigrations, options.namespace);

  const latest = getLatestMigrationNumber(target.migrationsDir);
  if (targetVersion > latest) {
    throw new Error(
      `Migration ${formatMigrationNumber(targetVersion)} does not exist in working tree (latest is ${formatMigrationNumber(latest)}).`,
    );
  }

  const snapshot = reconstructSnapshotFromMigrations(target.migrationsDir, targetVersion);
  if (!snapshot) {
    throw new Error(
      `No initial schema snapshot found in ${target.migrationsDir}. Expected 0000/schema.json.`,
    );
  }

  const accessToken = await loadAccessToken({
    useProfile: false,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const remoteTypes = await fetchRemoteTypes(client, workspaceId, target.namespace);
  const existingTypeNames = new Set(remoteTypes.map((t) => t.name));
  const { creates, updates, deletes } = compareSnapshotWithRemote(snapshot, existingTypeNames);

  logger.newline();
  logger.info(`Namespace: ${styles.bold(target.namespace)}`);
  logger.log(`  Target migration: ${styles.bold(formatMigrationNumber(targetVersion))}`);
  logger.log(`  Types to create: ${styles.bold(String(creates.length))}`);
  logger.log(`  Types to update: ${styles.bold(String(updates.length))}`);
  logger.log(`  Types to delete: ${styles.bold(String(deletes.length))}`);
  logger.newline();

  const totalChanges = creates.length + updates.length + deletes.length;
  if (totalChanges === 0) {
    // Even with no schema changes, the label may be stale, so still update it.
    logger.info("Remote schema already matches the target snapshot.");
  } else {
    logger.warn(
      "This operation will overwrite remote TailorDB types to match the selected snapshot.",
    );
    logger.warn("Existing data in deleted types will be lost.");
    logger.newline();
  }

  if (!options.yes) {
    const confirmation = await prompt.confirm({
      message: `Continue and set migration label to ${formatMigrationNumber(targetVersion)}?`,
      default: false,
    });
    if (!confirmation) {
      logger.info("Operation cancelled.");
      return;
    }
    logger.newline();
  }

  const manifests = generateAllTypeManifestsFromSnapshot(snapshot);

  for (const typeName of creates) {
    const tailordbType = manifests.get(typeName);
    if (!tailordbType) continue;
    await client.createTailorDBType({
      workspaceId,
      namespaceName: target.namespace,
      tailordbType,
    });
  }
  for (const typeName of updates) {
    const tailordbType = manifests.get(typeName);
    if (!tailordbType) continue;
    await client.updateTailorDBType({
      workspaceId,
      namespaceName: target.namespace,
      tailordbType,
    });
  }
  for (const typeName of deletes) {
    await client.deleteTailorDBType({
      workspaceId,
      namespaceName: target.namespace,
      tailordbTypeName: typeName,
    });
  }

  const trn = resourceTrn(workspaceId, "tailordb", target.namespace);
  const { metadata } = await client.getMetadata({ trn });
  const existingLabels = metadata?.labels ?? {};
  await client.setMetadata({
    trn,
    labels: {
      ...existingLabels,
      "sdk-migration": `m${formatMigrationNumber(targetVersion)}`,
    },
  });

  logger.success(
    `Synced namespace ${styles.bold(target.namespace)} to migration ${styles.bold(formatMigrationNumber(targetVersion))}.`,
  );

  if (targetVersion < latest) {
    logger.newline();
    logger.info(
      `Run 'tailor-sdk deploy' to apply migrations ${formatMigrationNumber(
        targetVersion + 1,
      )}–${formatMigrationNumber(latest)} from the working tree.`,
    );
  }
}

export const syncCommand = defineAppCommand({
  name: "sync",
  description:
    "Sync remote TailorDB schema to a specific migration snapshot (recovery from --no-schema-check drift).",
  args: z
    .object({
      ...deploymentArgs,
      ...confirmationArgs,
      number: arg(z.string(), {
        positional: true,
        description: "Migration number to sync to (e.g., 0001 or 1)",
      }),
      namespace: arg(z.string().optional(), {
        alias: "n",
        description: "Target TailorDB namespace (required if multiple namespaces exist)",
      }),
    })
    .strict(),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    await sync({
      configPath: args.config,
      number: args.number,
      namespace: args.namespace,
      yes: args.yes,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
  },
});
