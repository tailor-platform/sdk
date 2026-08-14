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
import {
  formatDiffSummary,
  formatMigrationDiff,
  type MigrationDiff,
  type WarningChangeInfo,
} from "./diff-calculator";
import { formatMigrationScriptCommand } from "./hints";
import {
  checkMigrationDiffs,
  logRemoteDriftGuidance,
  toTailorDBDeployInput,
  verifyRemoteSchema,
  type MigrationCheckResult,
} from "./schema-checks";
import {
  assertValidMigrationFiles,
  formatMigrationNumber,
  formatSchemaDrifts,
  getMigrationFilePath,
  getMigrationFiles,
  loadDiff,
  reconstructSnapshotFromMigrations,
} from "./snapshot";
import { MIGRATION_REVIEW_REQUIRED_MARKER } from "./template-generator";
import type {
  RemoteSchemaVerificationResult,
  RemoteSchemaVerificationSkipReason,
  SchemaDrift,
} from "./types";

export interface ValidateOptions {
  configPath?: string;
  namespace?: string;
  workspaceId?: string;
  profile?: string;
  json?: boolean;
  strict?: boolean;
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
  checkpointRepair?: { from: number; to: 0 };
}

interface FailedRemoteSchemaReport {
  skipped: "check_failed";
  remoteMigrationNumber?: never;
  hasDrift?: never;
  drifts?: never;
  checkpointMissingLocal?: never;
  checkpointRepair?: never;
}

type RemoteSchemaReport = CompletedRemoteSchemaReport | FailedRemoteSchemaReport;

interface UnacknowledgedWarningMigration {
  migrationNumber: number;
  warnings: WarningChangeInfo[];
}

interface WarningAcknowledgmentsReport {
  valid: boolean;
  /** Pending migrations with data-loss warnings but no migrate.ts and no recorded acknowledgment */
  missing: UnacknowledgedWarningMigration[];
}

interface NamespaceValidationReport {
  namespace: string;
  valid: boolean;
  migrationFiles: MigrationFilesReport;
  /** Omitted when the migration files are invalid (the check cannot run) */
  localSchema?: LocalSchemaReport;
  /** Omitted when the migration files are invalid */
  remoteSchema?: RemoteSchemaReport;
  /** Present only with --strict; omitted when the remote migration checkpoint is unknown */
  warningAcknowledgments?: WarningAcknowledgmentsReport;
}

interface BuildValidationReportsOptions {
  targetNamespaces: NamespaceWithMigrations[];
  migrationFileErrors: Map<string, string>;
  localResults: MigrationCheckResult[];
  remoteResults?: RemoteSchemaVerificationResult[];
  /** Per-namespace candidates for the --strict warning acknowledgment check */
  unacknowledgedWarnings?: Map<string, UnacknowledgedWarningMigration[]>;
}

interface CollectedValidationReports {
  reports: NamespaceValidationReport[];
  remoteError?: unknown;
}

/**
 * Walk the local migration history once to assert that every required
 * migration script exists, no migration carries both a --no-script
 * acknowledgment and a migrate.ts, and generated normalization logic has
 * been reviewed, and to collect migrations with data-loss warnings that
 * have neither a migrate.ts nor a recorded --no-script acknowledgment
 * @param {string} migrationsDir - Migrations directory path
 * @param {string} namespace - TailorDB namespace (for error messages)
 * @param {string} [configPath] - Config path the current run used (for remediation hints)
 * @returns {UnacknowledgedWarningMigration[]} Unacknowledged warning migrations in the local history
 */
function assertMigrationScriptsReady(
  migrationsDir: string,
  namespace: string,
  configPath?: string,
): UnacknowledgedWarningMigration[] {
  const missing: number[] = [];
  const conflicting: number[] = [];
  const unreviewed: number[] = [];
  const unacknowledgedWarnings: UnacknowledgedWarningMigration[] = [];
  for (const file of getMigrationFiles(migrationsDir)) {
    if (file.type !== "diff") continue;
    const diff = loadDiff(file.path);
    const migrateFilePath = getMigrationFilePath(migrationsDir, file.number, "migrate");
    const hasScript = fs.existsSync(migrateFilePath);
    if (diff.requiresMigrationScript && !diff.scriptSkipped && !hasScript) {
      missing.push(file.number);
    }
    if (diff.scriptSkipped && hasScript) {
      conflicting.push(file.number);
    }
    if (
      hasScript &&
      fs.readFileSync(migrateFilePath, "utf8").includes(MIGRATION_REVIEW_REQUIRED_MARKER)
    ) {
      unreviewed.push(file.number);
    }
    if (diff.hasWarnings && !diff.scriptSkipped && !hasScript) {
      unacknowledgedWarnings.push({ migrationNumber: file.number, warnings: diff.warnings });
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Migration(s) ${missing.map(formatMigrationNumber).join(", ")} in namespace "${namespace}" ` +
        "require a migration script but have no migrate.ts. " +
        "Add one with 'tailor tailordb migration script <number>', or record that no script " +
        `is needed with 'tailor tailordb migration script <number> --no-script --reason "..."'.`,
    );
  }
  if (conflicting.length > 0) {
    const clearCommands = conflicting
      .map(
        (migrationNumber) =>
          `  ${formatMigrationScriptCommand({ migrationNumber, namespace, configPath })}`,
      )
      .join("\n");
    throw new Error(
      `Migration(s) ${conflicting.map(formatMigrationNumber).join(", ")} in namespace "${namespace}" ` +
        "have both a --no-script skip acknowledgment and migrate.ts. " +
        "Clear the stale acknowledgment(s):\n" +
        `${clearCommands}\n` +
        "Or delete migrate.ts to keep the skip.",
    );
  }
  if (unreviewed.length > 0) {
    throw new Error(
      `Migration(s) ${unreviewed.map(formatMigrationNumber).join(", ")} in namespace "${namespace}" ` +
        "contain generated normalization logic that still requires review in migrate.ts. " +
        `Review each ${MIGRATION_REVIEW_REQUIRED_MARKER} marker, then remove the marker and its associated ` +
        "`never` annotation.",
    );
  }
  return unacknowledgedWarnings;
}

/**
 * Build per-namespace reports from the checks that completed
 * @param {BuildValidationReportsOptions} options - Completed validation results
 * @returns {NamespaceValidationReport[]} Validation reports per namespace
 */
function buildValidationReports(
  options: BuildValidationReportsOptions,
): NamespaceValidationReport[] {
  const {
    targetNamespaces,
    migrationFileErrors,
    localResults,
    remoteResults,
    unacknowledgedWarnings,
  } = options;

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
    const checkpointMissingLocal = remote.checkpointMissingLocal === true;
    const remoteSchema: RemoteSchemaReport = {
      remoteMigrationNumber: remote.remoteMigrationNumber,
      hasDrift: remote.hasDrift,
      drifts: remote.drifts,
      ...(remote.skipped ? { skipped: remote.skipped } : {}),
      ...(checkpointMissingLocal ? { checkpointMissingLocal: true } : {}),
      ...(remote.checkpointRepair ? { checkpointRepair: remote.checkpointRepair } : {}),
    };

    // Only migrations not yet applied to the remote need an acknowledgment;
    // for applied ones the data is already gone and there is nothing to act on.
    const candidates = unacknowledgedWarnings?.get(target.namespace);
    let warningAcknowledgments: WarningAcknowledgmentsReport | undefined;
    if (candidates !== undefined) {
      const missing = candidates.filter(
        (candidate) => candidate.migrationNumber > remote.remoteMigrationNumber,
      );
      warningAcknowledgments = { valid: missing.length === 0, missing };
    }

    return {
      namespace: target.namespace,
      valid:
        !localSchema.hasDiff &&
        !remoteSchema.hasDrift &&
        !checkpointMissingLocal &&
        warningAcknowledgments?.valid !== false,
      migrationFiles: { valid: true },
      localSchema,
      remoteSchema,
      ...(warningAcknowledgments ? { warningAcknowledgments } : {}),
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
  const unacknowledgedWarnings = options.strict
    ? new Map<string, UnacknowledgedWarningMigration[]>()
    : undefined;
  for (const target of targetNamespaces) {
    try {
      assertValidMigrationFiles(target.migrationsDir, target.namespace);
      // Parse the whole history here so malformed snapshot/diff contents are
      // reported per namespace instead of aborting the run for every namespace.
      reconstructSnapshotFromMigrations(target.migrationsDir);
      const namespaceWarnings = assertMigrationScriptsReady(
        target.migrationsDir,
        target.namespace,
        options.configPath,
      );
      unacknowledgedWarnings?.set(target.namespace, namespaceWarnings);
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
    ...(unacknowledgedWarnings ? { unacknowledgedWarnings } : {}),
  };

  if (checkableNamespaces.length === 0) {
    return {
      reports: buildValidationReports(localReportOptions),
    };
  }

  let remoteResults: RemoteSchemaVerificationResult[];
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
    } else if (remote?.checkpointRepair) {
      logger.log(
        `  Remote schema: ${styles.success("OK")} (next deploy will reset the checkpoint to 0000 from ${formatMigrationNumber(remote.checkpointRepair.from)})`,
      );
    } else if (remote?.checkpointMissingLocal) {
      logger.log(
        `  Remote schema: ${styles.error(
          `remote migration ${formatMigrationNumber(remote.remoteMigrationNumber)} is not in the local migration history`,
        )}`,
      );
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

    const acknowledgments = report.warningAcknowledgments;
    if (acknowledgments) {
      if (acknowledgments.valid) {
        logger.log(`  Warning acknowledgments: ${styles.success("OK")}`);
      } else {
        logger.log(
          `  Warning acknowledgments: ${styles.error("missing for pending migration(s) with possible data loss")}`,
        );
        for (const migration of acknowledgments.missing) {
          const label = formatMigrationNumber(migration.migrationNumber);
          for (const warning of migration.warnings) {
            const field = warning.fieldName ? `.${warning.fieldName}` : "";
            logger.log(`    ${label}: ${warning.tableName}${field}: ${warning.reason}`);
          }
        }
      }
    }
  }
  logger.newline();
}

function printResolutionHints(reports: NamespaceValidationReport[], configPath?: string): void {
  if (reports.some((r) => r.localSchema?.hasDiff && !r.localSchema.diff)) {
    logger.info("Run 'tailor tailordb migration generate' to create the initial snapshot.");
  }
  if (reports.some((r) => r.localSchema?.diff)) {
    logger.info("Run 'tailor tailordb migration generate' to create migration files.");
  }
  if (reports.some((r) => r.remoteSchema?.checkpointMissingLocal)) {
    logger.info(
      "The remote migration checkpoint is ahead of the local history. Pull the latest migration files, or run 'tailor tailordb migration status' to compare.",
    );
  }
  if (reports.some((r) => r.remoteSchema?.hasDrift)) {
    logRemoteDriftGuidance();
  }
  const missingAcknowledgments = reports.filter(
    (r) => r.warningAcknowledgments && !r.warningAcknowledgments.valid,
  );
  if (missingAcknowledgments.length > 0) {
    logger.info(
      "For each migration listed, either add a data migration script with 'tailor tailordb migration script <number>' or record why none is needed:",
    );
    for (const report of missingAcknowledgments) {
      for (const migration of report.warningAcknowledgments?.missing ?? []) {
        logger.info(
          `  ${formatMigrationScriptCommand({
            migrationNumber: migration.migrationNumber,
            namespace: report.namespace,
            configPath,
            noScript: true,
          })}`,
          { mode: "plain" },
        );
      }
    }
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
      printResolutionHints(reports, options.configPath);
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
    "Validate the full migration history, unreviewed generated migration scripts, and schema drift (local tables vs. migration snapshot, remote schema vs. migration checkpoint) without deploying. This includes the migration and schema-drift checks used by 'deploy' and exits with a non-zero code when issues are found.",
  args: z.strictObject({
    ...deploymentArgs,
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (validates all namespaces if not specified)",
    }),
    strict: arg(z.boolean().default(false), {
      description: "Also fail when a pending migration can drop data without an acknowledgment",
    }),
  }),
  run: async (args) => {
    await validate({
      configPath: args.config,
      namespace: args.namespace,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      json: logger.jsonMode,
      strict: args.strict,
    });
  },
});
