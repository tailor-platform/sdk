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
import { PluginManager } from "@/plugin/manager";
import { getNamespacesWithMigrations, type NamespaceWithMigrations } from "./config";
import { formatMigrationDiff, hasChanges } from "./diff-calculator";
import {
  assertValidMigrationFiles,
  compareLocalTypesWithSnapshot,
  createSnapshotFromLocalTypes,
  formatMigrationNumber,
  isValidMigrationNumber,
  reconstructSnapshotFromMigrations,
  getLatestMigrationNumber,
} from "./snapshot";
import {
  compareSnapshotWithRemote,
  generateAllTypeManifestsFromSnapshot,
  type GenerateAllManifestsOptions,
} from "./snapshot-manifest";
import { MIGRATION_LABEL_KEY, MIGRATION_LABEL_PREFIX, parseMigrationLabelNumber } from "./types";
import type { TailorDBType as ProtoTailorDBType } from "@tailor-proto/tailor/v1/tailordb_resource_pb";

export interface SyncOptions {
  configPath?: string;
  number: string;
  namespace?: string;
  yes?: boolean;
  workspaceId?: string;
  profile?: string;
}

// Accept either the canonical 4-digit form ("0000") or a bare integer
// ("0"–"9999"), mirroring `migration script`. Reject non-digit input,
// integer forms with leading zeros ("01"), and anything outside the
// 0000-9999 directory range that the migrations system supports.
function parseMigrationNumberArg(numberStr: string): number {
  if (isValidMigrationNumber(numberStr)) {
    return parseInt(numberStr, 10);
  }
  if (/^(0|[1-9]\d*)$/.test(numberStr)) {
    const parsed = parseInt(numberStr, 10);
    if (parsed > 9999) {
      throw new Error(`Migration number ${numberStr} is out of range. Expected 0-9999.`);
    }
    return parsed;
  }
  throw new Error(
    `Invalid migration number format: ${numberStr}. Expected 4-digit format (e.g., 0001) or integer 0-9999 (e.g., 1).`,
  );
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

/**
 * Verify that replaying the full migration history reproduces the current
 * local type definitions, before anything is sent to the remote.
 *
 * Sync force-applies a snapshot reconstructed from the migration history, so
 * the history itself must be trustworthy. When the reconstruction at the
 * latest migration does not match the schema defined in the local type files,
 * either the migration files were edited incorrectly or a schema change has
 * not been recorded as a migration yet — and overwriting the remote with an
 * unverified snapshot could destroy data. Fails before any RPC is issued.
 *
 * Returns the manifest generation options deploy would use for this
 * namespace (executor-driven publishRecordEvents and namespace
 * gqlOperations), so the synced manifests match what deploy produces.
 * @param loaded - Result of `loadConfig` (config and plugins)
 * @param target - Namespace whose migration history is being synced
 * @returns Options for `generateAllTypeManifestsFromSnapshot`
 */
async function assertMigrationsReproduceLocalTypes(
  loaded: Awaited<ReturnType<typeof loadConfig>>,
  target: NamespaceWithMigrations,
): Promise<GenerateAllManifestsOptions> {
  const { config, plugins } = loaded;
  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const { defineApplication } = await import("@/cli/services/application");
  const application = defineApplication({ config, pluginManager });

  const tailordbService = application.tailorDBServices.find(
    (s) => s.namespace === target.namespace,
  );
  if (!tailordbService) {
    throw new Error(`No TailorDB service found for namespace "${target.namespace}"`);
  }
  await tailordbService.loadTypes();
  await tailordbService.processNamespacePlugins();

  const executors = Object.values((await application.executorService?.loadExecutors()) ?? {});
  const executorUsedTypes = new Set<string>();
  for (const executor of executors) {
    if (executor.trigger.kind === "tailordb") {
      executorUsedTypes.add(executor.trigger.typeName);
    }
  }
  const manifestOptions: GenerateAllManifestsOptions = {
    executorUsedTypes,
    namespaceGqlOperations: tailordbService.config.gqlOperations,
  };

  const latestSnapshot = reconstructSnapshotFromMigrations(target.migrationsDir);
  if (!latestSnapshot) {
    return manifestOptions; // No migrations at all — reported by the caller's snapshot check.
  }
  const currentSnapshot = createSnapshotFromLocalTypes(tailordbService.types, target.namespace);
  const diff = compareLocalTypesWithSnapshot(
    latestSnapshot,
    currentSnapshot.types,
    target.namespace,
  );
  if (!hasChanges(diff)) {
    return manifestOptions;
  }

  logger.error(
    `Migration history does not reproduce the current local schema for namespace ${styles.bold(target.namespace)}:`,
  );
  logger.log(formatMigrationDiff(diff));
  logger.newline();
  logger.info("This usually means one of the following:");
  logger.info(
    "  - Migration files were edited and replaying them no longer matches the type definitions — fix the migration files.",
    { mode: "plain" },
  );
  logger.info(
    "  - Type definitions changed without a new migration — run 'tailor-sdk tailordb migration generate' first.",
    { mode: "plain" },
  );
  logger.newline();
  throw new Error(
    "Refusing to sync: the migration history must reproduce the current local schema before it can be applied to the remote.",
  );
}

interface RemoteMigrationState {
  /** Labels currently stored on the namespace metadata (empty when none exist) */
  labels: Record<string, string>;
  /** Current migration number parsed from the label, or null when unset/unparseable */
  current: number | null;
}

/**
 * Fetch the namespace's metadata labels and current migration number.
 *
 * Only GetMetadata NotFound is treated as "metadata does not exist yet".
 * Any other failure aborts the sync (which has not mutated anything at this
 * point): the fetched labels are written back verbatim at the end, so
 * proceeding with empty labels after a transient error would wipe the
 * namespace's existing metadata.
 * @param client - Operator client
 * @param trn - Namespace TRN
 * @returns Existing labels and the parsed current migration number
 */
async function fetchRemoteMigrationState(
  client: OperatorClient,
  trn: string,
): Promise<RemoteMigrationState> {
  try {
    const { metadata } = await client.getMetadata({ trn });
    const labels = metadata?.labels ?? {};
    const label = labels[MIGRATION_LABEL_KEY];
    return { labels, current: label ? parseMigrationLabelNumber(label) : null };
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return { labels: {}, current: null };
    }
    throw error;
  }
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
 * Updates the migration label to `<number>` on success. Before any remote
 * mutation, verifies that the migration history reproduces the current local
 * type definitions (see {@link assertMigrationsReproduceLocalTypes}).
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

  const loaded = await loadConfig(options.configPath);
  const { config } = loaded;
  const configDir = path.dirname(config.path);
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  const target = selectTargetNamespace(namespacesWithMigrations, options.namespace);

  assertValidMigrationFiles(target.migrationsDir, target.namespace);

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

  const manifestOptions = await assertMigrationsReproduceLocalTypes(loaded, target);

  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const trn = resourceTrn(workspaceId, "tailordb", target.namespace);
  const remoteState = await fetchRemoteMigrationState(client, trn);
  const remoteTypes = await fetchRemoteTypes(client, workspaceId, target.namespace);
  const existingTypeNames = new Set(remoteTypes.map((t) => t.name));
  const { creates, updates, deletes } = compareSnapshotWithRemote(snapshot, existingTypeNames);

  const current = remoteState.current;
  logger.newline();
  logger.info(`Namespace: ${styles.bold(target.namespace)}`);
  logger.log(
    `  Current migration: ${current === null ? "<unset>" : styles.bold(formatMigrationNumber(current))}`,
  );
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
    if (deletes.length > 0) {
      logger.warn("Existing data in deleted types will be lost.");
    }
    logger.newline();
  }

  if (current !== null && targetVersion < current) {
    logger.warn(
      `Migrations ${formatMigrationNumber(targetVersion + 1)}–${formatMigrationNumber(
        current,
      )} will become pending again and re-execute on the next deploy, including their migrate.ts scripts. Make sure those scripts are idempotent (safe to re-run).`,
    );
    logger.newline();
  } else if (current !== null && targetVersion > current) {
    logger.warn(
      `Moving the migration label forwards (${formatMigrationNumber(current)} → ${formatMigrationNumber(
        targetVersion,
      )}): migrate.ts scripts for migrations ${formatMigrationNumber(current + 1)}–${formatMigrationNumber(
        targetVersion,
      )} will not run on the next deploy.`,
    );
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

  const manifests = generateAllTypeManifestsFromSnapshot(snapshot, manifestOptions);

  // Resolve all manifests before issuing any RPC: a missing manifest
  // indicates an internal inconsistency, and skipping or failing midway
  // would leave the remote schema partially synced.
  const manifestFor = (typeName: string) => {
    const manifest = manifests.get(typeName);
    if (!manifest) {
      throw new Error(
        `Internal error: no manifest generated for type "${typeName}". No changes were applied.`,
      );
    }
    return manifest;
  };
  const createManifests = creates.map((typeName) => manifestFor(typeName));
  const updateManifests = updates.map((typeName) => manifestFor(typeName));

  await Promise.all([
    ...createManifests.map((tailordbType) =>
      client.createTailorDBType({
        workspaceId,
        namespaceName: target.namespace,
        tailordbType,
      }),
    ),
    ...updateManifests.map((tailordbType) =>
      client.updateTailorDBType({
        workspaceId,
        namespaceName: target.namespace,
        tailordbType,
      }),
    ),
  ]);
  await Promise.all(
    deletes.map((typeName) =>
      client.deleteTailorDBType({
        workspaceId,
        namespaceName: target.namespace,
        tailordbTypeName: typeName,
      }),
    ),
  );

  await client.setMetadata({
    trn,
    labels: {
      ...remoteState.labels,
      [MIGRATION_LABEL_KEY]: `${MIGRATION_LABEL_PREFIX}${formatMigrationNumber(targetVersion)}`,
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
        description:
          "Migration number to sync to (e.g., 0001 or 1; 0 targets the baseline snapshot)",
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
