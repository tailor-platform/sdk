import { arg } from "@politty/valibot";
import * as path from "pathe";
import * as v from "valibot";
import { resourceTrn } from "#/cli/commands/deploy/label";
import { deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger, styles } from "#/cli/shared/logger";
import { getNamespacesWithMigrations } from "./config";
import { fetchRemoteMigrationState } from "./remote-state";
import {
  getMigrationFiles,
  loadDiff,
  loadSnapshot,
  formatMigrationNumber,
  UnsupportedMigrationFileVersionError,
} from "./snapshot";

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
  status: "ok";
  namespace: string;
  currentMigration: number;
  currentMigrationLabel: string;
  pendingMigrations: PendingMigrationStatusInfo[];
}

interface MigrationStatusFailure {
  status: "error";
  namespace: string;
  error: string;
}

type MigrationStatusRow = MigrationStatusInfo | MigrationStatusFailure;

function isStatusFailure(row: MigrationStatusRow): row is MigrationStatusFailure {
  return row.status === "error";
}

async function collectMigrationStatuses(options: StatusOptions): Promise<MigrationStatusRow[]> {
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

  const localStates = new Map<
    string,
    {
      migrationFiles: ReturnType<typeof getMigrationFiles>;
      descriptions: Map<number, string>;
      historyId: string | null;
    }
  >();
  const localFailures = new Map<string, string>();

  for (const { namespace, migrationsDir } of targetNamespaces) {
    try {
      const migrationFiles = getMigrationFiles(migrationsDir);
      const descriptions = new Map<number, string>();
      let historyId: string | null = null;
      for (const file of migrationFiles) {
        if (file.type === "schema") {
          const snapshot = loadSnapshot(file.path);
          if (file.number === 0) {
            historyId = snapshot.rebaseline?.historyId ?? null;
          }
          continue;
        }
        try {
          const diff = loadDiff(file.path);
          if (diff.description) descriptions.set(file.number, diff.description);
        } catch (error) {
          if (error instanceof UnsupportedMigrationFileVersionError) throw error;
          // A malformed optional description must not hide migration status.
        }
      }
      localStates.set(namespace, { migrationFiles, descriptions, historyId });
    } catch (error) {
      localFailures.set(namespace, error instanceof Error ? error.message : String(error));
    }
  }

  if (localStates.size === 0) {
    return targetNamespaces.map(({ namespace }) => ({
      status: "error",
      namespace,
      error: localFailures.get(namespace) ?? "Failed to read local migration history.",
    }));
  }

  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const rows: MigrationStatusRow[] = [];

  for (const { namespace } of targetNamespaces) {
    if (localFailures.has(namespace)) {
      rows.push({
        status: "error",
        namespace,
        error: localFailures.get(namespace) ?? "Failed to read local migration history.",
      });
      continue;
    }
    const localState = localStates.get(namespace);
    if (!localState) {
      rows.push({
        status: "error",
        namespace,
        error: "Failed to read local migration history.",
      });
      continue;
    }
    const { migrationFiles, descriptions, historyId: localHistoryId } = localState;

    const trn = resourceTrn(workspaceId, "tailordb", namespace);
    let remoteState;
    try {
      remoteState = await fetchRemoteMigrationState(client, trn);
    } catch (error) {
      rows.push({
        status: "error",
        namespace,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const currentMigration = remoteState.number ?? 0;

    if (remoteState.historyIdInvalid) {
      rows.push({
        status: "error",
        namespace,
        error: "Remote migration history ID is invalid.",
      });
      continue;
    }

    const hasRemoteMigrationState = remoteState.number !== null || remoteState.historyId !== null;
    if (hasRemoteMigrationState && remoteState.historyId !== localHistoryId) {
      rows.push({
        status: "error",
        namespace,
        error:
          `Remote migration history ID ${remoteState.historyId ?? "<unset>"} does not match ` +
          `local migration history ID ${localHistoryId ?? "<unset>"}.`,
      });
      continue;
    }

    const availableNumbers = migrationFiles
      .map((f) => f.number)
      .filter((n, i, arr) => arr.indexOf(n) === i) // deduplicate
      .toSorted((a, b) => a - b);
    const pendingNumbers = availableNumbers.filter((n) => n > currentMigration);

    const pendingMigrations = pendingNumbers.map((num) => ({
      number: num,
      label: formatMigrationNumber(num),
      ...(descriptions.has(num) ? { description: descriptions.get(num) } : {}),
    }));

    rows.push({
      status: "ok",
      namespace,
      currentMigration,
      currentMigrationLabel: formatMigrationNumber(currentMigration),
      pendingMigrations,
    });
  }

  return rows;
}

function printMigrationStatuses(rows: MigrationStatusRow[]): void {
  for (const row of rows) {
    logger.newline();
    logger.info(`Namespace: ${styles.bold(row.namespace)}`);
    if (isStatusFailure(row)) {
      logger.error(`  Migration status error: ${row.error}`);
      continue;
    }
    logger.log(`  Current migration: ${styles.bold(row.currentMigrationLabel)}`);

    if (row.pendingMigrations.length > 0) {
      logger.log("  Pending migrations:");
      for (const pending of row.pendingMigrations) {
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

  const rows = await collectMigrationStatuses(options);
  if (options.json) {
    logger.out(rows);
  } else {
    printMigrationStatuses(rows);
  }

  const failures = rows.filter(isStatusFailure);
  if (failures.length > 0) {
    const namespaces = failures.map((f) => f.namespace).join(", ");
    throw new Error(
      `Migration status check failed for ${failures.length} namespace${failures.length === 1 ? "" : "s"}: ${namespaces}`,
    );
  }
}

export const statusCommand = defineAppCommand({
  name: "status",
  description:
    "Show the current migration status for TailorDB namespaces, including applied and pending migrations.",
  notes:
    "Every local migration file is checked for a compatible format version, and deployed migration history IDs must match the local baseline. Compatibility errors, history mismatches, and metadata lookup failures are reported per namespace and make the command exit non-zero; only a not-yet-deployed namespace is treated as having no applied migrations.",
  args: v.strictObject({
    ...deploymentArgs,
    namespace: arg(v.optional(v.string()), {
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
