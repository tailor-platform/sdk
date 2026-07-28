import * as fs from "node:fs";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { assertUniqueLocalTailorDBTypeNames } from "#/cli/services/tailordb/type-name-validation";
import { deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger, styles } from "#/cli/shared/logger";
import { PluginManager } from "#/plugin/manager";
import { assertDefined } from "#/utils/assert";
import { getNamespacesWithMigrations, type NamespaceWithMigrations } from "./config";
import { formatDiffSummary, formatMigrationDiff, type MigrationDiff } from "./diff-calculator";
import {
  checkMigrationDiffs,
  logRemoteDriftGuidance,
  toTailorDBDeployInput,
  verifyRemoteSchema,
} from "./schema-checks";
import {
  assertValidMigrationFiles,
  formatMigrationNumber,
  formatSchemaDrifts,
  getLatestMigrationNumber,
  getMigrationFilePath,
  getMigrationFiles,
  loadDiff,
  reconstructSnapshotFromMigrations,
} from "./snapshot";
import type { RemoteSchemaVerificationSkipReason, SchemaDrift } from "./types";

export interface ValidateOptions {
  configPath?: string;
  namespace?: string;
  workspaceId?: string;
  profile?: string;
  json?: boolean;
}

interface MigrationFilesReport {
  valid: boolean;
  error?: string;
}

interface LocalSchemaReport {
  hasDiff: boolean;
  /** Present when local types drifted from the latest migration snapshot; absent when the drift is a missing snapshot */
  diff?: MigrationDiff;
}

interface CompletedRemoteSchemaReport {
  remoteMigrationNumber: number;
  hasDrift: boolean;
  drifts: SchemaDrift[];
  /** Set when the remote check could not run (no remote migration label, or no snapshot at the remote migration number) */
  skipped?: RemoteSchemaVerificationSkipReason;
  /** Set when the remote migration checkpoint does not exist in the local migration history */
  checkpointMissingLocal?: boolean;
}

interface FailedRemoteSchemaReport {
  skipped: "check_failed";
  remoteMigrationNumber?: never;
  hasDrift?: never;
  drifts?: never;
  checkpointMissingLocal?: never;
}

type RemoteSchemaReport = CompletedRemoteSchemaReport | FailedRemoteSchemaReport;

interface NamespaceValidationReport {
  namespace: string;
  valid: boolean;
  migrationFiles: MigrationFilesReport;
  /** Omitted when the migration files are invalid (the check cannot run) */
  localSchema?: LocalSchemaReport;
  /** Omitted when the migration files are invalid */
  remoteSchema?: RemoteSchemaReport;
}

interface BuildValidationReportsOptions {
  targetNamespaces: NamespaceWithMigrations[];
  migrationFileErrors: Map<string, string>;
  localResults: Awaited<ReturnType<typeof checkMigrationDiffs>>;
  remoteResults?: Awaited<ReturnType<typeof verifyRemoteSchema>>;
}

interface CollectedValidationReports {
  reports: NamespaceValidationReport[];
  remoteError?: unknown;
}

/**
 * Assert that every migration in the local history whose diff requires a data
 * migration script has a migrate.ts on disk or an explicit skip acknowledgment
 * @param {string} migrationsDir - Migrations directory path
 * @param {string} namespace - TailorDB namespace (for error messages)
 */
function assertRequiredMigrationScripts(migrationsDir: string, namespace: string): void {
  const missing: number[] = [];
  for (const file of getMigrationFiles(migrationsDir)) {
    if (file.type !== "diff") continue;
    const diff = loadDiff(file.path);
    if (!diff.requiresMigrationScript || diff.scriptSkipped) continue;
    if (!fs.existsSync(getMigrationFilePath(migrationsDir, file.number, "migrate"))) {
      missing.push(file.number);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Migration(s) ${missing.map(formatMigrationNumber).join(", ")} in namespace "${namespace}" ` +
        "require a migration script but have no migrate.ts. " +
        "Add one with 'tailor-sdk tailordb migration script <number>', or record that no script " +
        `is needed with 'tailor-sdk tailordb migration script <number> --no-script --reason "..."'.`,
    );
  }
}

/**
 * Build per-namespace reports from the checks that completed
 * @param {BuildValidationReportsOptions} options - Completed validation results
 * @returns {NamespaceValidationReport[]} Validation reports per namespace
 */
function buildValidationReports(
  options: BuildValidationReportsOptions,
): NamespaceValidationReport[] {
  const { targetNamespaces, migrationFileErrors, localResults, remoteResults } = options;

  return targetNamespaces.map((target) => {
    const fileError = migrationFileErrors.get(target.namespace);
    if (fileError !== undefined) {
      return {
        namespace: target.namespace,
        valid: false,
        migrationFiles: { valid: false, error: fileError },
      };
    }

    const local = assertDefined(
      localResults.find((result) => result.namespace === target.namespace),
      `local schema check result missing for namespace "${target.namespace}"`,
    );
    const localSchema: LocalSchemaReport = {
      hasDiff: local.hasDiff,
      ...(local.diff ? { diff: local.diff } : {}),
    };
    if (remoteResults === undefined) {
      return {
        namespace: target.namespace,
        valid: false,
        migrationFiles: { valid: true },
        localSchema,
        remoteSchema: { skipped: "check_failed" },
      };
    }

    const remote = assertDefined(
      remoteResults.find((result) => result.namespace === target.namespace),
      `remote schema check result missing for namespace "${target.namespace}"`,
    );
    const checkpointMissingLocal =
      !remote.skipped &&
      remote.remoteMigrationNumber > getLatestMigrationNumber(target.migrationsDir);
    // The remote result was compared against the latest available local
    // snapshot, not the missing checkpoint, so its drift details are invalid.
    const hasDrift = !checkpointMissingLocal && remote.hasDrift;
    const remoteSchema: RemoteSchemaReport = {
      remoteMigrationNumber: remote.remoteMigrationNumber,
      hasDrift,
      drifts: checkpointMissingLocal ? [] : remote.drifts,
      ...(remote.skipped ? { skipped: remote.skipped } : {}),
      ...(checkpointMissingLocal ? { checkpointMissingLocal: true } : {}),
    };

    return {
      namespace: target.namespace,
      valid: !localSchema.hasDiff && !remoteSchema.hasDrift && !checkpointMissingLocal,
      migrationFiles: { valid: true },
      localSchema,
      remoteSchema,
    };
  });
}

/**
 * Run all migration validation checks and collect per-namespace reports
 * @param {ValidateOptions} options - Command options
 * @returns {Promise<CollectedValidationReports>} Validation reports and any remote error
 */
async function collectValidationReports(
  options: ValidateOptions,
): Promise<CollectedValidationReports> {
  const { config, plugins } = await loadConfig(options.configPath);
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

  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const { defineApplication } = await import("#/cli/services/application");
  const application = defineApplication({ config, pluginManager });
  // Load every namespace (not just the targets): plugins registered while
  // types load may contribute types to the target namespaces.
  for (const service of application.tailorDBServices) {
    await service.loadTypes();
    await service.processNamespacePlugins();
  }
  assertUniqueLocalTailorDBTypeNames({ tailorDBServices: application.tailorDBServices });
  for (const { namespace } of targetNamespaces) {
    if (!application.tailorDBServices.some((s) => s.namespace === namespace)) {
      throw new Error(`No TailorDB service found for namespace "${namespace}"`);
    }
  }
  const tailorDBInputs = application.tailorDBServices.map(toTailorDBDeployInput);
  const typesByNamespace = new Map(tailorDBInputs.map((input) => [input.namespace, input.types]));

  const migrationFileErrors = new Map<string, string>();
  const checkableNamespaces: NamespaceWithMigrations[] = [];
  for (const target of targetNamespaces) {
    try {
      assertValidMigrationFiles(target.migrationsDir, target.namespace);
      // Parse the whole history here so malformed snapshot/diff contents are
      // reported per namespace instead of aborting the run for every namespace.
      reconstructSnapshotFromMigrations(target.migrationsDir);
      assertRequiredMigrationScripts(target.migrationsDir, target.namespace);
      checkableNamespaces.push(target);
    } catch (error) {
      migrationFileErrors.set(
        target.namespace,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const localResults = await checkMigrationDiffs(typesByNamespace, checkableNamespaces);
  const localReportOptions = {
    targetNamespaces,
    migrationFileErrors,
    localResults,
  };

  if (checkableNamespaces.length === 0) {
    return {
      reports: buildValidationReports(localReportOptions),
    };
  }

  let remoteResults: Awaited<ReturnType<typeof verifyRemoteSchema>>;
  try {
    const accessToken = await loadAccessToken({
      profile: options.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: options.workspaceId,
      profile: options.profile,
    });
    remoteResults = await verifyRemoteSchema(
      client,
      workspaceId,
      checkableNamespaces,
      config,
      tailorDBInputs,
    );
  } catch (remoteError) {
    return {
      reports: buildValidationReports(localReportOptions),
      remoteError,
    };
  }

  return {
    reports: buildValidationReports({ ...localReportOptions, remoteResults }),
  };
}

function printValidationReports(reports: NamespaceValidationReport[]): void {
  for (const report of reports) {
    logger.newline();
    logger.info(`Namespace: ${styles.bold(report.namespace)}`);

    if (!report.migrationFiles.valid) {
      logger.log(`  Migration files: ${styles.error("invalid")}`);
      logger.log(`    ${report.migrationFiles.error}`);
      continue;
    }
    logger.log(`  Migration files: ${styles.success("OK")}`);

    const local = report.localSchema;
    if (local?.hasDiff) {
      if (local.diff) {
        logger.log(`  Local schema: ${styles.error("changes not in migration files")}`);
        logger.log(`    ${formatDiffSummary(local.diff)}`);
        logger.log(formatMigrationDiff(local.diff));
      } else {
        logger.log(`  Local schema: ${styles.error("no migration snapshot found")}`);
      }
    } else {
      logger.log(`  Local schema: ${styles.success("OK")}`);
    }

    const remote = report.remoteSchema;
    if (remote?.skipped === "check_failed") {
      logger.log(`  Remote schema: ${styles.error("not checked")}`);
    } else if (remote?.checkpointMissingLocal) {
      logger.log(
        `  Remote schema: ${styles.error(
          `remote migration ${formatMigrationNumber(remote.remoteMigrationNumber)} is not in the local migration history`,
        )}`,
      );
      if (remote.hasDrift) {
        logger.log(formatSchemaDrifts(remote.drifts));
      }
    } else if (remote?.hasDrift) {
      logger.log(
        `  Remote schema: ${styles.error("drift detected")} (remote migration: ${formatMigrationNumber(remote.remoteMigrationNumber)})`,
      );
      logger.log(formatSchemaDrifts(remote.drifts));
    } else if (remote?.skipped === "not_deployed") {
      logger.log(`  Remote schema: ${styles.dim("skipped (namespace not deployed)")}`);
    } else if (remote?.skipped === "no_migration_label") {
      logger.log(
        `  Remote schema: ${styles.dim("skipped (deployed namespace has no migration state)")}`,
      );
    } else if (remote?.skipped === "no_snapshot") {
      logger.log(
        `  Remote schema: ${styles.dim(`skipped (no local snapshot for remote migration ${formatMigrationNumber(remote.remoteMigrationNumber)})`)}`,
      );
    } else if (remote) {
      logger.log(
        `  Remote schema: ${styles.success("OK")} (remote migration: ${formatMigrationNumber(remote.remoteMigrationNumber)})`,
      );
    }
  }
  logger.newline();
}

function printResolutionHints(reports: NamespaceValidationReport[]): void {
  if (reports.some((r) => r.localSchema?.hasDiff && !r.localSchema.diff)) {
    logger.info("Run 'tailor-sdk tailordb migration generate' to create the initial snapshot.");
  }
  if (reports.some((r) => r.localSchema?.diff)) {
    logger.info("Run 'tailor-sdk tailordb migration generate' to create migration files.");
  }
  if (reports.some((r) => r.remoteSchema?.checkpointMissingLocal)) {
    logger.info(
      "The remote migration checkpoint is ahead of the local history. Pull the latest migration files, or run 'tailor-sdk tailordb migration status' to compare.",
    );
  }
  if (reports.some((r) => r.remoteSchema?.hasDrift)) {
    logRemoteDriftGuidance();
  }
}

/**
 * Validate migration files and schema state without deploying
 * @param {ValidateOptions} options - Command options
 */
async function validate(options: ValidateOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  const collected = await collectValidationReports(options);
  const { reports } = collected;
  const invalidCount = reports.filter((r) => !r.valid).length;

  if (options.json) {
    logger.out(reports);
  } else {
    printValidationReports(reports);
    if (invalidCount === 0 && !("remoteError" in collected)) {
      logger.success("All migration validation checks passed.");
    } else {
      printResolutionHints(reports);
    }
  }

  if ("remoteError" in collected) {
    throw collected.remoteError;
  }
  if (invalidCount > 0) {
    throw new Error(`Migration validation failed for ${invalidCount} namespace(s)`);
  }
}

export const validateCommand = defineAppCommand({
  name: "validate",
  description:
    "Validate the full migration history and detect schema drift (local types vs. migration snapshot, remote schema vs. migration checkpoint) without deploying. This includes the migration and schema-drift checks used by 'deploy' and exits with a non-zero code when issues are found.",
  args: z
    .object({
      ...deploymentArgs,
      namespace: arg(z.string().optional(), {
        alias: "n",
        description: "Target TailorDB namespace (validates all namespaces if not specified)",
      }),
    })
    .strict(),
  run: async (args) => {
    await validate({
      configPath: args.config,
      namespace: args.namespace,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      json: logger.jsonMode,
    });
  },
});
